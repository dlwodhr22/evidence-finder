// PLAN 작업 6: 법령(법률·시행령·시행규칙 등)과 자치법규(모든 지자체의 조례·규칙) 검색·본문 조회.
// 법제처 호출은 공통 도구(law-api.ts)를 통해서만 한다.
//
// Design Ref: §1.2 원칙 1 — 법제처에서 확인된 자료만 화면에 올린다.
// PRD 5번 A — 법령은 현행 여부와 시행일을 함께 표시한다(문서 검토 13번: 빠진 항목은 내보내지 않는다).
// PRD 5번 A — 조문을 현행 본문에서 찾지 못하면 근거로 쓰지 않는다(findArticle이 undefined를 돌려줌).
//
// 이 파일은 서버 전용이다.
import {
  asArray,
  callLawApi,
  isRecord,
  lawApiFailure,
  publicLink,
  searchLaw,
  type LawApiResult,
  type LawRawItem,
} from "./law-api";
import type { LawItem } from "./types";

/** 검색 방식: 법령 이름으로 찾기, 또는 법령 본문 내용으로 찾기 */
export type LawSearchMode = "name" | "fulltext";

export interface LawSearchOptions {
  mode?: LawSearchMode;
  page?: number;
  display?: number; // 한 번에 받을 개수
}

export interface LawItemPage {
  totalCount: number; // 법제처 전체 검색 결과 수
  items: LawItem[]; // 현행 여부·시행일 등 필수 정보가 모두 있는 항목만
}

/** 조문 한 개 */
export interface LawArticle {
  label: string; // 예: "제72조", "제8조의2"
  number: number; // 72
  branch: number; // 가지번호(제8조의2 → 2). 없으면 0
  title: string; // 조문 제목(예: "변상금의 징수")
  text: string; // 조문 전체 글(항·호·목 포함, 법제처 원문 그대로)
  effectiveDate: string; // 조문 시행일 YYYY-MM-DD
  notYetEffective: boolean; // 조문 전체가 아직 시행되지 않았으면(시행 예정) true
  pendingParts: string[]; // 아직 시행되지 않은 부분. 예: "제73조제2항 (2027-08-20 시행 예정)"
}

/** 법령·자치법규 본문 */
export interface LawDocument {
  source: "law" | "ordin";
  id: string;
  title: string;
  lawType: string;
  authority: string;
  effectiveDate: string; // YYYY-MM-DD
  sourceUrl: string;
  articles: LawArticle[];
}

// ─────────────────────────────────────────────────────────────
// 작은 도구들 (자동 시험 대상)
// ─────────────────────────────────────────────────────────────

/** "20260820" → "2026-08-20". 형식이 맞지 않으면 빈 글. */
export function formatLawDate(raw: string | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** 오늘 날짜(한국 시간) YYYY-MM-DD */
export function todayInKorea(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 법제처 응답의 글 칸은 글, 글 목록, 없음 중 하나로 온다. 항상 글로 바꾼다. */
function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("\n");
  return "";
}

/** "제72조", "72조", "제8조의2", "8조의 2" → { number, branch }. 알아볼 수 없으면 null. */
export function parseArticleLabel(label: string): { number: number; branch: number } | null {
  const m = label.replace(/\s+/g, "").match(/^제?(\d+)조(?:의(\d+))?$/);
  if (!m) return null;
  return { number: Number(m[1]), branch: m[2] ? Number(m[2]) : 0 };
}

export function articleLabel(number: number, branch: number): string {
  return branch > 0 ? `제${number}조의${branch}` : `제${number}조`;
}

/** 본문에서 조문을 찾는다. 없으면 undefined(= 현행 본문에 없는 조문이므로 근거로 쓰지 않는다). */
export function findArticle(doc: LawDocument, label: string): LawArticle | undefined {
  const target = parseArticleLabel(label);
  if (!target) return undefined;
  return doc.articles.find((a) => a.number === target.number && a.branch === target.branch);
}

/** 법령 조문 한 개(조문단위)를 글로 합친다: 조문내용 → 항 → 호 → 목 순서 */
export function buildStatuteArticleText(unit: Record<string, unknown>): string {
  const lines: string[] = [toText(unit["조문내용"])];
  const pushItems = (holder: Record<string, unknown>) => {
    for (const ho of asArray(holder["호"]).filter(isRecord)) {
      lines.push(toText(ho["호내용"]));
      for (const mok of asArray(ho["목"]).filter(isRecord)) lines.push(toText(mok["목내용"]));
    }
  };
  for (const hang of asArray(unit["항"]).filter(isRecord)) {
    lines.push(toText(hang["항내용"]));
    pushItems(hang);
  }
  pushItems(unit); // 항 없이 호가 바로 오는 경우
  return lines.filter(Boolean).join("\n");
}

/** 조문별 시행일 정보 한 건 */
export interface ArticleEffectiveEntry {
  date: string; // YYYY-MM-DD
  number: number;
  branch: number;
  part: string; // 예: "제73조제2항", "제73조의4"
  whole: boolean; // 조문 전체이면 true, 항·호 일부이면 false
}

/**
 * 법령 기본정보의 "조문시행일자문자열"을 읽는다.
 * 예: "20260219:제18조제1항제5호, 제73조의220270820:제73조의4"
 *   → 2026-02-19: 제18조제1항제5호, 제73조의2 / 2027-08-20: 제73조의4
 * 조문 칸의 시행일에는 시행 예정 날짜가 반영되지 않는 경우가 있어(2026-11-04 확인), 이 정보로 보완한다.
 */
export function parseArticleEffectiveDates(raw: string): ArticleEffectiveEntry[] {
  const entries: ArticleEffectiveEntry[] = [];
  for (const m of raw.matchAll(/(\d{8}):([\s\S]*?)(?=\d{8}:|$)/g)) {
    const date = formatLawDate(m[1]);
    for (const piece of m[2].split(",")) {
      const part = piece.replace(/\s+/g, "");
      const am = part.match(/^제(\d+)조(?:의(\d+))?(.*)$/);
      if (!date || !am) continue;
      entries.push({
        date,
        number: Number(am[1]),
        branch: am[2] ? Number(am[2]) : 0,
        part,
        whole: am[3] === "",
      });
    }
  }
  return entries;
}

/** 자치법규 조문번호 "000602" → 제6조의2 */
export function parseOrdinanceArticleNo(raw: unknown): { number: number; branch: number } | null {
  const first = toText(asArray(raw as string | string[])[0] ?? "");
  const digits = first.replace(/\D/g, "");
  if (digits.length !== 6) return null;
  return { number: Number(digits.slice(0, 4)), branch: Number(digits.slice(4, 6)) };
}

// ─────────────────────────────────────────────────────────────
// 검색
// ─────────────────────────────────────────────────────────────

function searchParams(mode: LawSearchMode): { search?: number } {
  // 법제처 검색 방식: 1 = 이름, 2 = 본문
  return mode === "fulltext" ? { search: 2 } : {};
}

/** 법제처 법령 검색 결과 한 건 → LawItem. 필수 정보가 빠졌으면 null(화면에 올리지 않음). */
export function toStatuteItem(raw: LawRawItem): LawItem | null {
  const id = raw["법령일련번호"]?.trim();
  const title = raw["법령명한글"]?.trim();
  const effectiveDate = formatLawDate(raw["시행일자"]);
  const status = raw["현행연혁코드"]?.trim();
  if (!id || !title || !effectiveDate || !status) return null;
  return {
    kind: "law",
    source: "law",
    id,
    title,
    lawType: raw["법령구분명"]?.trim() || "법령",
    authority: raw["소관부처명"]?.trim() || "",
    isCurrent: status === "현행",
    effectiveDate,
    sourceUrl: publicLink("law", id),
  };
}

/**
 * 법제처 자치법규 검색 결과 한 건 → LawItem.
 * 법제처 자치법규 목록은 현행 자치법규 목록이다. 제개정 구분이 "폐지"이면 현행이 아닌 것으로 본다.
 */
export function toOrdinanceItem(raw: LawRawItem): LawItem | null {
  const id = raw["자치법규일련번호"]?.trim();
  const title = raw["자치법규명"]?.trim();
  const effectiveDate = formatLawDate(raw["시행일자"]);
  if (!id || !title || !effectiveDate) return null;
  return {
    kind: "law",
    source: "ordin",
    id,
    title,
    lawType: raw["자치법규종류"]?.trim() || "자치법규",
    authority: raw["지자체기관명"]?.trim() || "",
    isCurrent: !(raw["제개정구분명"] ?? "").includes("폐지"),
    effectiveDate,
    sourceUrl: publicLink("ordin", id),
  };
}

async function searchAndMap(
  target: "law" | "ordin",
  query: string,
  { mode = "name", page = 1, display = 10 }: LawSearchOptions,
): Promise<LawApiResult<LawItemPage>> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, data: { totalCount: 0, items: [] } };

  const result = await searchLaw(target, trimmed, { page, display, ...searchParams(mode) });
  if (!result.ok) return result;

  const toItem = target === "law" ? toStatuteItem : toOrdinanceItem;
  const items = result.data.items.map(toItem).filter((item): item is LawItem => item !== null);
  return { ok: true, data: { totalCount: result.data.totalCount, items } };
}

/** 법률·시행령·시행규칙 등 법령 검색 */
export function searchStatutes(query: string, options: LawSearchOptions = {}) {
  return searchAndMap("law", query, options);
}

/** 모든 지자체의 조례·규칙(자치법규) 검색 */
export function searchOrdinances(query: string, options: LawSearchOptions = {}) {
  return searchAndMap("ordin", query, options);
}

// ─────────────────────────────────────────────────────────────
// 본문 조회
// ─────────────────────────────────────────────────────────────

/**
 * 법령 본문을 가져온다. id는 법령 검색 결과의 id(법령일련번호)다.
 * 현행 여부는 검색 결과(LawItem.isCurrent)로 판단한다. 이 본문은 그 일련번호의 본문이다.
 */
export async function getStatute(id: string, today = todayInKorea()): Promise<LawApiResult<LawDocument>> {
  const result = await callLawApi("lawService.do", { target: "law", MST: id });
  if (!result.ok) return result;

  const law = isRecord(result.data) ? result.data["법령"] : undefined;
  if (!isRecord(law) || !isRecord(law["기본정보"])) return lawApiFailure("BAD_RESPONSE");
  const info = law["기본정보"];
  const lawTypeInfo = info["법종구분"];
  const authorityInfo = info["소관부처"];

  const units = isRecord(law["조문"]) ? asArray(law["조문"]["조문단위"]).filter(isRecord) : [];
  const docDate = formatLawDate(toText(info["시행일자"]));
  // 오늘 이후에 시행되는 부분(시행 예정)만 모은다.
  const pending = parseArticleEffectiveDates(toText(info["조문시행일자문자열"])).filter(
    (e) => e.date > today,
  );

  const articles: LawArticle[] = units
    .filter((u) => toText(u["조문여부"]) === "조문") // "전문"은 장·절 제목이므로 뺀다
    .map((u) => {
      const number = Number(toText(u["조문번호"]));
      const branch = Number(toText(u["조문가지번호"]) || 0);
      const mine = pending.filter((e) => e.number === number && e.branch === branch);
      const wholePending = mine.find((e) => e.whole);
      const effectiveDate =
        wholePending?.date || formatLawDate(toText(u["조문시행일자"])) || docDate;
      return {
        label: articleLabel(number, branch),
        number,
        branch,
        title: toText(u["조문제목"]),
        text: buildStatuteArticleText(u),
        effectiveDate,
        notYetEffective: Boolean(wholePending) || (effectiveDate !== "" && effectiveDate > today),
        pendingParts: mine.map((e) => `${e.part} (${e.date} 시행 예정)`),
      };
    })
    .filter((a) => Number.isFinite(a.number) && a.text !== "");

  const title = toText(info["법령명_한글"]);
  if (!title || articles.length === 0) return lawApiFailure("BAD_RESPONSE");

  return {
    ok: true,
    data: {
      source: "law",
      id,
      title,
      lawType: isRecord(lawTypeInfo) ? toText(lawTypeInfo["content"]) : "법령",
      authority: isRecord(authorityInfo) ? toText(authorityInfo["content"]) : "",
      effectiveDate: docDate,
      sourceUrl: publicLink("law", id),
      articles,
    },
  };
}

// 자치법규 본문의 종류 코드. 법제처 응답에서 "조례"와 짝지어 확인한 값만 적는다.
const ORDINANCE_TYPE_CODES: Record<string, string> = { C0001: "조례" };

/** 자치법규 본문을 가져온다. id는 자치법규 검색 결과의 id(자치법규일련번호)다. */
export async function getOrdinance(id: string, today = todayInKorea()): Promise<LawApiResult<LawDocument>> {
  const result = await callLawApi("lawService.do", { target: "ordin", MST: id });
  if (!result.ok) return result;

  const root = isRecord(result.data) ? result.data["LawService"] : undefined;
  if (!isRecord(root) || !isRecord(root["자치법규기본정보"])) return lawApiFailure("BAD_RESPONSE");
  const info = root["자치법규기본정보"];
  const docDate = formatLawDate(toText(info["시행일자"]));

  const rows = isRecord(root["조문"]) ? asArray(root["조문"]["조"]).filter(isRecord) : [];
  const articles: LawArticle[] = [];
  for (const row of rows) {
    if (toText(row["조문여부"]) !== "Y") continue;
    const no = parseOrdinanceArticleNo(row["조문번호"]);
    const text = toText(row["조내용"]);
    if (!no || !text) continue;
    articles.push({
      label: articleLabel(no.number, no.branch),
      number: no.number,
      branch: no.branch,
      title: toText(row["조제목"]),
      text,
      effectiveDate: docDate,
      notYetEffective: docDate !== "" && docDate > today,
      pendingParts: [],
    });
  }

  const title = toText(info["자치법규명"]);
  if (!title || articles.length === 0) return lawApiFailure("BAD_RESPONSE");

  const typeCode = toText(info["자치법규종류"]);
  return {
    ok: true,
    data: {
      source: "ordin",
      id,
      title,
      lawType: ORDINANCE_TYPE_CODES[typeCode] ?? "자치법규",
      authority: toText(info["지자체기관명"]),
      effectiveDate: docDate,
      sourceUrl: publicLink("ordin", id),
      articles,
    },
  };
}

// PLAN 작업 8: 법령해석례·행정심판례 검색·본문 조회, 그리고 "같은 자료인지" 판정.
// 법제처 호출은 공통 도구(law-api.ts)를 통해서만 한다.
//
// Design Ref: §1.2 원칙 1 — 법제처에서 확인된 자료만 화면에 올린다.
// 문서 검토 10번 — 자료 종류별 일치 기준: 해석례 = 안건번호 + 회신일, 행정심판례 = 사건번호 + 재결일.
//
// 이 파일은 서버 전용이다.
import {
  htmlToText,
  normalizeCaseNumber,
  normalizeDate,
  type CaseSection,
} from "./cases";
import {
  callLawApi,
  isRecord,
  lawApiFailure,
  publicLink,
  searchLaw,
  type LawApiResult,
  type LawRawItem,
} from "./law-api";
import type { InterpretationItem, TribunalItem } from "./types";

export type RulingSource = "expc" | "decc"; // expc = 법령해석례, decc = 행정심판례
export type RulingItem = InterpretationItem | TribunalItem;

export interface RulingSearchOptions {
  mode?: "name" | "fulltext"; // 안건명·사건명(또는 번호)으로 찾기 / 본문으로 찾기
  page?: number;
  display?: number;
}

export interface RulingItemPage<T extends RulingItem> {
  totalCount: number; // 법제처 전체 검색 결과 수
  items: T[]; // 번호·날짜 등 필수 정보가 모두 있는 항목만
}

export interface RulingDocument {
  source: RulingSource;
  id: string;
  title: string;
  caseNumber: string; // 안건번호 또는 사건번호
  authority: string; // 회신기관 또는 재결청
  decisionDate: string; // 회신일 또는 재결일 YYYY-MM-DD
  sourceUrl: string;
  sections: CaseSection[]; // 내용이 있는 부분만(법제처 원문 그대로)
}

/** 웹검색 등에서 찾은 단서 */
export interface RulingClue {
  caseNumber?: string; // 안건번호 또는 사건번호
  decisionDate?: string; // 회신일 또는 재결일
}

// ─────────────────────────────────────────────────────────────
// 정리와 판정 (자동 시험 대상)
// ─────────────────────────────────────────────────────────────

/** 법령해석례 검색 결과 한 건 → InterpretationItem. 안건번호·회신일 중 하나라도 없으면 null. */
export function toInterpretationItem(raw: LawRawItem): InterpretationItem | null {
  const id = raw["법령해석례일련번호"]?.trim();
  const caseNumber = normalizeCaseNumber(raw["안건번호"]);
  const decisionDate = normalizeDate(raw["회신일자"]);
  if (!id || !caseNumber || !decisionDate) return null;
  return {
    kind: "interpretation",
    id,
    title: raw["안건명"]?.trim() || caseNumber,
    caseNumber,
    authority: raw["회신기관명"]?.trim() || "",
    requester: raw["질의기관명"]?.trim() || "",
    decisionDate,
    sourceUrl: publicLink("expc", id),
  };
}

/** 행정심판례 검색 결과 한 건 → TribunalItem. 사건번호·재결일 중 하나라도 없으면 null. */
export function toTribunalItem(raw: LawRawItem): TribunalItem | null {
  const id = raw["행정심판재결례일련번호"]?.trim();
  const caseNumber = normalizeCaseNumber(raw["사건번호"]);
  const decisionDate = normalizeDate(raw["의결일자"]);
  if (!id || !caseNumber || !decisionDate) return null;
  return {
    kind: "tribunal",
    id,
    title: raw["사건명"]?.trim() || caseNumber,
    caseNumber,
    authority: raw["재결청"]?.trim() || "",
    decisionDate,
    sourceUrl: publicLink("decc", id),
  };
}

/**
 * 단서가 이 자료와 같은지 판정한다.
 * 번호와 날짜가 모두 있고, 모두 같아야 true. 하나라도 없거나 다르면 false(= 확인되지 않음).
 */
export function isSameRuling(item: Pick<RulingItem, "caseNumber" | "decisionDate">, clue: RulingClue): boolean {
  const clueNumber = normalizeCaseNumber(clue.caseNumber);
  const clueDate = normalizeDate(clue.decisionDate);
  if (!clueNumber || !clueDate) return false;
  return normalizeCaseNumber(item.caseNumber) === clueNumber && normalizeDate(item.decisionDate) === clueDate;
}

// ─────────────────────────────────────────────────────────────
// 검색
// ─────────────────────────────────────────────────────────────

async function searchAndMap<T extends RulingItem>(
  source: RulingSource,
  toItem: (raw: LawRawItem) => T | null,
  query: string,
  { mode = "name", page = 1, display = 10 }: RulingSearchOptions,
): Promise<LawApiResult<RulingItemPage<T>>> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, data: { totalCount: 0, items: [] } };

  const result = await searchLaw(source, trimmed, {
    page,
    display,
    ...(mode === "fulltext" ? { search: 2 } : {}),
  });
  if (!result.ok) return result;

  const items = result.data.items.map(toItem).filter((item): item is T => item !== null);
  return { ok: true, data: { totalCount: result.data.totalCount, items } };
}

/** 법령해석례 검색. 안건명이나 안건번호로 찾거나(name), 질의·회답 본문으로 찾는다(fulltext). */
export function searchInterpretations(query: string, options: RulingSearchOptions = {}) {
  return searchAndMap("expc", toInterpretationItem, query, options);
}

/** 행정심판례 검색. 사건명이나 사건번호로 찾거나(name), 재결 본문으로 찾는다(fulltext). */
export function searchTribunalDecisions(query: string, options: RulingSearchOptions = {}) {
  return searchAndMap("decc", toTribunalItem, query, options);
}

/**
 * 단서(번호·날짜)로 법제처에서 찾아, 둘 다 일치하는 것만 돌려준다.
 * 일치하는 것이 없으면 null(= 확인되지 않음, 근거로 쓰지 않는다).
 */
export async function findRulingByClue(
  source: RulingSource,
  clue: RulingClue,
): Promise<LawApiResult<RulingItem | null>> {
  const caseNumber = normalizeCaseNumber(clue.caseNumber);
  if (!caseNumber) return { ok: true, data: null };
  const result =
    source === "expc"
      ? await searchInterpretations(caseNumber, { display: 20 })
      : await searchTribunalDecisions(caseNumber, { display: 20 });
  if (!result.ok) return result;
  const items: RulingItem[] = result.data.items;
  return { ok: true, data: items.find((item) => isSameRuling(item, clue)) ?? null };
}

// ─────────────────────────────────────────────────────────────
// 본문 조회
// ─────────────────────────────────────────────────────────────

function textOf(value: unknown): string {
  return typeof value === "string" ? htmlToText(value) : "";
}

// 본문의 칸과 보여줄 순서
const SECTIONS: Record<RulingSource, string[]> = {
  expc: ["질의요지", "회답", "이유"],
  decc: ["주문", "청구취지", "재결요지", "이유"],
};

/**
 * 해석례·행정심판례 본문을 가져온다. id는 검색 결과의 id(일련번호)다.
 * 행정심판례 본문은 맨 바깥 이름표가 "PrecService"로 온다(2026-11-04 확인). 이름표에 기대지 않고 내용으로 찾는다.
 */
export async function getRuling(source: RulingSource, id: string): Promise<LawApiResult<RulingDocument>> {
  const result = await callLawApi("lawService.do", { target: source, ID: id });
  if (!result.ok) return result;

  const root = isRecord(result.data) ? Object.values(result.data).find(isRecord) : undefined;
  if (!root) return lawApiFailure("BAD_RESPONSE");

  const isInterpretation = source === "expc";
  const caseNumber = normalizeCaseNumber(textOf(isInterpretation ? root["안건번호"] : root["사건번호"]));
  const decisionDate = normalizeDate(textOf(isInterpretation ? root["해석일자"] : root["의결일자"]));
  const authority = textOf(isInterpretation ? root["해석기관명"] : root["재결청"]);
  const title = textOf(isInterpretation ? root["안건명"] : root["사건명"]);
  const sections = SECTIONS[source]
    .map((heading) => ({ heading, text: textOf(root[heading]) }))
    .filter((s) => s.text !== "");

  if (!caseNumber || !decisionDate || sections.length === 0) return lawApiFailure("BAD_RESPONSE");

  return {
    ok: true,
    data: {
      source,
      id,
      title: title || caseNumber,
      caseNumber,
      authority,
      decisionDate,
      sourceUrl: publicLink(source, id),
      sections,
    },
  };
}

/** 본문 전체를 하나의 글로(원문 구절 확인 등에 쓴다) */
export function rulingFullText(doc: RulingDocument): string {
  return doc.sections.map((s) => `【${s.heading}】\n${s.text}`).join("\n\n");
}

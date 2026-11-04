// PLAN 작업 7: 판례(법원)와 헌법재판소 결정 검색·본문 조회, 그리고 "같은 판례인지" 판정.
// 법제처 호출은 공통 도구(law-api.ts)를 통해서만 한다.
//
// Design Ref: §1.2 원칙 1 — 법제처에서 확인된 자료만 화면에 올린다.
// PRD 5번 A — 사건번호만이 아니라 법원과 선고일까지 일치해야 확인된 것으로 본다.
// 문서 검토 10번 — 띄어쓰기·날짜 형식·법원 약칭 같은 표기 차이는 정리한 뒤 비교한다.
//
// 이 파일은 서버 전용이다.
import {
  callLawApi,
  isRecord,
  lawApiFailure,
  publicLink,
  searchLaw,
  type LawApiResult,
  type LawRawItem,
} from "./law-api";
import type { CaseItem } from "./types";

export type CaseSource = "prec" | "detc";
export type CaseSearchMode = "name" | "fulltext"; // 사건명으로 찾기 / 판결문 본문으로 찾기

export interface CaseSearchOptions {
  mode?: CaseSearchMode;
  page?: number;
  display?: number;
  newestFirst?: boolean; // true면 선고일 최신순
}

export interface CaseItemPage {
  totalCount: number; // 법제처 전체 검색 결과 수
  items: CaseItem[]; // 사건번호·법원·선고일이 모두 있는 항목만
}

/** 판결문(결정문) 본문의 한 부분 */
export interface CaseSection {
  heading: string; // 예: "판시사항", "판결요지", "판례내용"
  text: string; // 법제처 원문 그대로(HTML 줄바꿈 표시만 글 줄바꿈으로 바꿈)
}

export interface CaseDocument {
  source: CaseSource;
  id: string;
  title: string;
  caseNumber: string;
  court: string;
  decisionDate: string; // YYYY-MM-DD
  sourceUrl: string;
  sections: CaseSection[]; // 내용이 있는 부분만
}

const CONSTITUTIONAL_COURT = "헌법재판소";

// ─────────────────────────────────────────────────────────────
// 표기 정리 (자동 시험 대상)
// ─────────────────────────────────────────────────────────────

/** 전각 숫자(０１２)를 보통 숫자로 바꾼다 */
function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 날짜를 YYYY-MM-DD로 맞춘다.
 * "20240627", "2024.06.27", "2024. 6. 27.", "2024-6-27" 모두 → "2024-06-27". 알아볼 수 없으면 빈 글.
 */
export function normalizeDate(raw: string | undefined): string {
  const text = toHalfWidthDigits(raw ?? "").trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  const parts = compact ?? text.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?$/);
  if (!parts) return "";
  const [y, m, d] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 사건번호 표기를 맞춘다: 띄어쓰기·전각 숫자·끝의 "호"를 정리. 예: "2024 두 31284" → "2024두31284" */
export function normalizeCaseNumber(raw: string | undefined): string {
  return toHalfWidthDigits(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/호$/, "")
    .trim();
}

/** 법원 이름 표기를 맞춘다: 띄어쓰기와 흔한 줄임말(서울고법 → 서울고등법원 등)을 정리 */
export function normalizeCourt(raw: string | undefined): string {
  let court = (raw ?? "").replace(/\s+/g, "");
  if (court === "대법" || court === "대법원") return "대법원";
  if (court === "헌재" || court === CONSTITUTIONAL_COURT) return CONSTITUTIONAL_COURT;
  court = court
    .replace(/고법$/, "고등법원")
    .replace(/지법/, "지방법원")
    .replace(/행법$/, "행정법원")
    .replace(/가법$/, "가정법원")
    .replace(/특허법$/, "특허법원");
  return court;
}

/** 웹검색 등에서 찾은 판례 단서 */
export interface CaseClue {
  caseNumber?: string;
  court?: string;
  decisionDate?: string;
}

/**
 * 단서가 법제처의 판례와 같은 사건인지 판정한다.
 * 사건번호·법원·선고일 세 가지가 모두 있고, 모두 같아야 true(PRD 5번 A).
 * 하나라도 없거나 다르면 false → 확인된 것으로 보지 않는다.
 */
export function isSameCase(item: Pick<CaseItem, "caseNumber" | "court" | "decisionDate">, clue: CaseClue): boolean {
  const clueNumber = normalizeCaseNumber(clue.caseNumber);
  const clueCourt = normalizeCourt(clue.court);
  const clueDate = normalizeDate(clue.decisionDate);
  if (!clueNumber || !clueCourt || !clueDate) return false;
  return (
    normalizeCaseNumber(item.caseNumber) === clueNumber &&
    normalizeCourt(item.court) === clueCourt &&
    normalizeDate(item.decisionDate) === clueDate
  );
}

/**
 * 법제처 판결문의 HTML 표시를 글로 바꾼다.
 * 줄바꿈(<br/>)은 줄바꿈으로, 나머지 표시는 지우고, &lt; 같은 기호 표기만 원래 글자로 되돌린다.
 * 글자 내용은 바꾸지 않는다(원문 그대로 보여주기 위해).
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─────────────────────────────────────────────────────────────
// 검색
// ─────────────────────────────────────────────────────────────

/** 법원 판례 검색 결과 한 건 → CaseItem. 사건번호·법원·선고일 중 하나라도 없으면 null. */
export function toPrecedentItem(raw: LawRawItem): CaseItem | null {
  const id = raw["판례일련번호"]?.trim();
  const caseNumber = normalizeCaseNumber(raw["사건번호"]);
  const court = raw["법원명"]?.trim() ?? "";
  const decisionDate = normalizeDate(raw["선고일자"]);
  if (!id || !caseNumber || !court || !decisionDate) return null;
  return {
    kind: "case",
    source: "prec",
    id,
    title: raw["사건명"]?.trim() || caseNumber,
    caseNumber,
    court,
    decisionDate,
    decisionType: raw["판결유형"]?.trim() || "판결",
    sourceUrl: publicLink("prec", id),
  };
}

/** 헌법재판소 결정 검색 결과 한 건 → CaseItem. 결정일이 "0"(없음)이면 null. */
export function toConstitutionalItem(raw: LawRawItem): CaseItem | null {
  const id = raw["헌재결정례일련번호"]?.trim();
  const caseNumber = normalizeCaseNumber(raw["사건번호"]);
  const decisionDate = normalizeDate(raw["종국일자"]);
  if (!id || !caseNumber || !decisionDate) return null;
  return {
    kind: "case",
    source: "detc",
    id,
    title: raw["사건명"]?.replace(/\s+/g, " ").trim() || caseNumber,
    caseNumber,
    court: CONSTITUTIONAL_COURT,
    decisionDate,
    decisionType: "결정",
    sourceUrl: publicLink("detc", id),
  };
}

async function searchAndMap(
  source: CaseSource,
  query: string,
  { mode = "name", page = 1, display = 10, newestFirst = false }: CaseSearchOptions,
): Promise<LawApiResult<CaseItemPage>> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, data: { totalCount: 0, items: [] } };

  const result = await searchLaw(source, trimmed, {
    page,
    display,
    ...(mode === "fulltext" ? { search: 2 } : {}),
    ...(newestFirst ? { sort: "ddes" as const } : {}),
  });
  if (!result.ok) return result;

  const toItem = source === "prec" ? toPrecedentItem : toConstitutionalItem;
  const items = result.data.items.map(toItem).filter((item): item is CaseItem => item !== null);
  return { ok: true, data: { totalCount: result.data.totalCount, items } };
}

/** 법원 판례 검색. 사건명 또는 사건번호로 찾거나(name), 판결문 본문으로 찾는다(fulltext). */
export function searchPrecedents(query: string, options: CaseSearchOptions = {}) {
  return searchAndMap("prec", query, options);
}

/** 헌법재판소 결정 검색 */
export function searchConstitutionalDecisions(query: string, options: CaseSearchOptions = {}) {
  return searchAndMap("detc", query, options);
}

/**
 * 단서(사건번호·법원·선고일)로 법제처에서 판례를 찾아, 세 가지가 모두 일치하는 것만 돌려준다.
 * 일치하는 것이 없으면 null(= 확인되지 않음, 근거로 쓰지 않는다).
 */
export async function findCaseByClue(clue: CaseClue): Promise<LawApiResult<CaseItem | null>> {
  const caseNumber = normalizeCaseNumber(clue.caseNumber);
  if (!caseNumber) return { ok: true, data: null };
  const source: CaseSource = normalizeCourt(clue.court) === CONSTITUTIONAL_COURT ? "detc" : "prec";
  const result = await searchAndMap(source, caseNumber, { display: 20 });
  if (!result.ok) return result;
  return { ok: true, data: result.data.items.find((item) => isSameCase(item, clue)) ?? null };
}

// ─────────────────────────────────────────────────────────────
// 본문 조회
// ─────────────────────────────────────────────────────────────

function textOf(value: unknown): string {
  return typeof value === "string" ? htmlToText(value) : "";
}

// 법원 판례 본문의 칸과 보여줄 순서
const PRECEDENT_SECTIONS = ["판시사항", "판결요지", "참조조문", "참조판례", "판례내용"];
// 헌법재판소 결정 본문의 칸과 보여줄 순서
const CONSTITUTIONAL_SECTIONS = ["판시사항", "결정요지", "심판대상조문", "참조조문", "참조판례", "전문"];

/**
 * 판결문(결정문) 본문을 가져온다. id는 검색 결과의 id(일련번호)다.
 * 본문 내용이 하나도 없으면(아직 공개되지 않은 결정 등) 실패로 돌려준다.
 */
export async function getCase(source: CaseSource, id: string): Promise<LawApiResult<CaseDocument>> {
  const result = await callLawApi("lawService.do", { target: source, ID: id });
  if (!result.ok) return result;

  const rootKey = source === "prec" ? "PrecService" : "DetcService";
  const root = isRecord(result.data) ? result.data[rootKey] : undefined;
  if (!isRecord(root)) return lawApiFailure("BAD_RESPONSE");

  const caseNumber = normalizeCaseNumber(textOf(root["사건번호"]));
  const decisionDate = normalizeDate(textOf(source === "prec" ? root["선고일자"] : root["종국일자"]));
  const court = source === "prec" ? textOf(root["법원명"]) : CONSTITUTIONAL_COURT;
  const headings = source === "prec" ? PRECEDENT_SECTIONS : CONSTITUTIONAL_SECTIONS;
  const sections = headings
    .map((heading) => ({ heading, text: textOf(root[heading]) }))
    .filter((s) => s.text !== "");

  if (!caseNumber || !decisionDate || !court || sections.length === 0) {
    return lawApiFailure("BAD_RESPONSE");
  }

  return {
    ok: true,
    data: {
      source,
      id,
      title: textOf(root["사건명"]).replace(/\s+/g, " ") || caseNumber,
      caseNumber,
      court,
      decisionDate,
      sourceUrl: publicLink(source, id),
      sections,
    },
  };
}

/** 본문 전체를 하나의 글로(원문 구절 확인 등에 쓴다) */
export function caseFullText(doc: CaseDocument): string {
  return doc.sections.map((s) => `【${s.heading}】\n${s.text}`).join("\n\n");
}

// PLAN 작업 10: 사안 → (개인정보 가림) → AI가 법령명·검색어 추출 → 법제처 검색.
// 웹검색 단서(작업 11)와 단서 재조회 검증(작업 12)은 이 흐름에 이어서 붙인다.
//
// Design Ref: §4.1 데이터 흐름 — [서버] 개인정보 감지·가림 → AI 검색어 추출 → 법제처 검색.
// Design Ref: §1.2 원칙 1 — 화면에 올리는 자료는 모두 법제처 검색 결과에서 나온다.
//   AI가 뽑은 법령명이 실제로 없으면 법제처 검색 결과가 0건이 될 뿐, 화면에 지어낸 법령이 나오지 않는다.
// Design Ref: §9 오류 처리 — AI 호출이 실패하면 입력한 쟁점·분야로 대신 찾고 그 사실을 알린다.
// 문서 검토 11번 — 자료 종류별로 상위 몇 건까지만 보여준다(MAX_PER_KIND).
//
// 이 파일은 서버 전용이다.
import { z } from "zod";
import { askAiJson } from "./ai";
import { maskCaseInput, type CaseInput } from "./case-input";
import { searchConstitutionalDecisions, searchPrecedents } from "./cases";
import type { LawApiResult } from "./law-api";
import { searchOrdinances, searchStatutes } from "./laws";
import type { PiiFinding } from "./pii";
import type { SearchResults } from "./results";
import { searchInterpretations, searchTribunalDecisions } from "./rulings";
import type { CaseItem, InterpretationItem, LawItem, TribunalItem } from "./types";

/** 자료 종류별로 화면에 보여줄 최대 건수 */
export const MAX_PER_KIND = 5;
const MAX_LAW_NAMES = 3;
const MAX_KEYWORDS = 4;
const MAX_TERM_LENGTH = 30;

/** AI가 사안에서 뽑은 검색 재료 */
export interface SearchTerms {
  lawNames: string[]; // 관련 법령의 정식 이름 후보(예: 국유재산법)
  keywords: string[]; // 본문 검색어(예: 무단점유, 변상금)
  source: "ai" | "fallback"; // AI가 뽑았는지, AI 실패로 입력 내용에서 대신 만들었는지
}

// 검색 결과(모두 법제처 검색 결과에서 나온 것)의 모양은 results.ts에 있다(화면에서도 쓰기 때문).
export type { SearchResults };

export interface SearchResponse {
  maskedInput: CaseInput; // 서버에서 한 번 더 가린 입력(원래 글은 돌려주지 않는다)
  piiFindings: PiiFinding[];
  terms: SearchTerms;
  results: SearchResults;
  notices: string[]; // 사용자에게 알릴 안내(AI 실패, 일부 자료 조회 실패 등)
  foundNothing: boolean; // 모든 종류에서 0건이면 true → 화면에 "찾지 못했다" 안내
}

// ─────────────────────────────────────────────────────────────
// 검색어 정리 (자동 시험 대상)
// ─────────────────────────────────────────────────────────────

/** 검색어를 정리한다: 앞뒤 빈칸·따옴표·괄호 제거, 너무 긴 말 제외, 중복 제거, 개수 제한 */
export function cleanTerms(terms: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw
      .replace(/[「」『』"'“”‘’()[\]{}<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!term || term.length > MAX_TERM_LENGTH || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/** AI를 쓸 수 없을 때: 입력한 관련 분야와 쟁점에서 검색어를 만든다 */
export function fallbackTerms(input: CaseInput): SearchTerms {
  const words = `${input.field} ${input.issue}`
    .split(/[\s,·/]+/)
    .map((w) => w.replace(/(이|가|을|를|은|는|의|에|에서|으로|로|와|과|도|만|지|인지|한지|할|수|있는지)$/, ""))
    .filter((w) => w.length >= 2);
  return { lawNames: [], keywords: cleanTerms(words, MAX_KEYWORDS), source: "fallback" };
}

/** 같은 자료가 여러 검색에서 나오면 하나만 남긴다(처음 나온 순서 유지) */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/** 관련 지자체를 적었으면 그 지자체 조례를 앞으로, 나머지를 뒤로 보낸다 */
export function preferLocalGov(items: LawItem[], localGov: string): LawItem[] {
  const name = localGov.replace(/\s+/g, "");
  if (!name) return items;
  const isLocal = (item: LawItem) =>
    item.authority.replace(/\s+/g, "").includes(name) || item.title.replace(/\s+/g, "").includes(name);
  return [...items.filter(isLocal), ...items.filter((item) => !isLocal(item))];
}

// ─────────────────────────────────────────────────────────────
// AI 검색어 추출
// ─────────────────────────────────────────────────────────────

const termsSchema = z.object({
  lawNames: z.array(z.string()).describe("관련 법령의 정식 이름. 확실한 것만. 없으면 빈 목록"),
  keywords: z.array(z.string()).describe("법령·판례 본문 검색에 쓸 짧은 법률 용어"),
});

const TERMS_INSTRUCTIONS = [
  "사안을 읽고 법제처 검색에 쓸 재료를 뽑는다.",
  `lawNames: 이 사안에 적용될 법령의 정식 이름(예: "국유재산법", "공유재산 및 물품 관리법")을 최대 ${MAX_LAW_NAMES}개. 확실하지 않으면 넣지 않는다. 조문 번호는 넣지 않는다.`,
  `keywords: 법령·판례 본문에서 찾을 짧은 법률 용어(예: "무단점유", "변상금", "시효")를 2~${MAX_KEYWORDS}개. 각 1~3단어. 일상어보다 법령에 쓰이는 말로 바꾼다.`,
  "사람 이름, 주소, 전화번호 같은 개인정보는 넣지 않는다.",
].join("\n");

async function extractTerms(input: CaseInput): Promise<{ terms: SearchTerms; notice?: string }> {
  const result = await askAiJson({
    instructions: TERMS_INSTRUCTIONS,
    input: [
      `사안 내용: ${input.facts}`,
      `판단해야 할 쟁점: ${input.issue}`,
      input.field ? `관련 분야: ${input.field}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    schema: termsSchema,
    schemaName: "search_terms",
  });

  if (result.ok) {
    const terms: SearchTerms = {
      lawNames: cleanTerms(result.data.lawNames, MAX_LAW_NAMES),
      keywords: cleanTerms(result.data.keywords, MAX_KEYWORDS),
      source: "ai",
    };
    if (terms.keywords.length > 0 || terms.lawNames.length > 0) return { terms };
  }
  const reason = result.ok ? "AI가 검색어를 뽑지 못해" : `${result.error.message} 그래서`;
  return {
    terms: fallbackTerms(input),
    notice: `${reason} 입력하신 쟁점과 분야의 낱말로 대신 찾았습니다.`,
  };
}

// ─────────────────────────────────────────────────────────────
// 법제처 검색
// ─────────────────────────────────────────────────────────────

type Collected<T> = { items: T[]; failed: boolean };

/** 여러 검색을 함께 돌려 결과를 모은다. 실패한 검색이 있으면 failed=true(나머지 결과는 살린다) */
async function collect<T extends { id: string }>(
  searches: Promise<LawApiResult<{ items: T[] }>>[],
): Promise<Collected<T>> {
  const results = await Promise.all(searches);
  const items: T[] = [];
  let failed = false;
  for (const r of results) {
    if (r.ok) items.push(...r.data.items);
    else failed = true;
  }
  return { items: dedupeById(items), failed };
}

/** 비교용: 띄어쓰기·가운뎃점·괄호 표기 차이를 없앤다 */
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, "").replace(/[ㆍ·・]/g, "·").replace(/[「」]/g, "");
}

/**
 * 관련성 거름망: 자료의 제목에 AI가 뽑은 법령명·검색어가 하나라도 들어 있어야 남긴다.
 * 법제처 본문 검색은 결과를 가나다순으로 주어, 사안과 상관없는 자료가 섞여 올라오기 때문이다
 * (시험 세트 2026-11-05: 조례의 추정 관련 비율 16%, 근거 없는 사안에서도 25건이 나옴).
 * 이 거름은 "관련 없는 것을 줄이는" 용도일 뿐이며, 자료의 존재 여부는 이미 법제처 조회로 확인된 것이다.
 */
export function matchesTerms(title: string, terms: Pick<SearchTerms, "lawNames" | "keywords">): boolean {
  const t = normalizeForMatch(title);
  return [...terms.lawNames, ...terms.keywords].some((term) => {
    const n = normalizeForMatch(term);
    return n.length >= 2 && t.includes(n);
  });
}

/**
 * 사안으로 근거를 찾는다.
 * @param input 입력 규칙(caseInputSchema)을 통과한 입력
 */
export async function searchEvidence(input: CaseInput): Promise<SearchResponse> {
  // 1) 서버에서 개인정보를 한 번 더 가린다(화면에서 이미 가렸더라도).
  const { masked, findings } = maskCaseInput(input);
  const notices: string[] = [];

  // 2) AI가 검색어를 뽑는다.
  const { terms, notice } = await extractTerms(masked);
  if (notice) notices.push(notice);

  const keywordQuery = terms.keywords.slice(0, 2).join(" ");
  const opts = { display: MAX_PER_KIND };
  const textOpts = { display: MAX_PER_KIND, mode: "fulltext" as const };
  // 판례·해석례·행정심판례: 사건명(안건명)에 검색어가 들어간 자료를 먼저(최신순), 그다음 본문 검색 결과(최신순).
  // 법제처 본문 검색은 결과를 이름 가나다순으로 주어 관련 없는 자료가 앞에 올 수 있기 때문이다(2026-11-04 확인).
  const nameNewest = { display: MAX_PER_KIND, newestFirst: true };
  const textNewest = { ...textOpts, newestFirst: true };
  const nameKeywords = terms.keywords.slice(0, 2);

  // 3) 법제처에서 종류별로 찾는다(함께 돌림).
  const [statutes, ordinances, precedents, constitutional, interpretations, tribunals] = await Promise.all([
    collect<LawItem>([
      ...terms.lawNames.map((name) => searchStatutes(name, opts)),
      ...(keywordQuery ? [searchStatutes(keywordQuery, textOpts)] : []),
    ]),
    collect<LawItem>(
      masked.localGov
        ? // 관련 지자체를 적었으면 "지자체 이름 + 검색어"로 먼저 찾고, 본문 검색도 함께 한다.
          [
            ...terms.keywords.slice(0, 2).map((k) => searchOrdinances(`${masked.localGov} ${k}`, opts)),
            ...(keywordQuery ? [searchOrdinances(keywordQuery, { display: 20, mode: "fulltext" })] : []),
          ]
        : keywordQuery
          ? [searchOrdinances(keywordQuery, textOpts)]
          : [],
    ),
    collect<CaseItem>([
      ...nameKeywords.map((k) => searchPrecedents(k, nameNewest)),
      ...(keywordQuery ? [searchPrecedents(keywordQuery, textNewest)] : []),
    ]),
    collect<CaseItem>([
      ...nameKeywords.map((k) => searchConstitutionalDecisions(k, nameNewest)),
      ...(keywordQuery ? [searchConstitutionalDecisions(keywordQuery, textNewest)] : []),
    ]),
    collect<InterpretationItem>([
      ...nameKeywords.map((k) => searchInterpretations(k, nameNewest)),
      ...(keywordQuery ? [searchInterpretations(keywordQuery, textNewest)] : []),
    ]),
    collect<TribunalItem>([
      ...nameKeywords.map((k) => searchTribunalDecisions(k, nameNewest)),
      ...(keywordQuery ? [searchTribunalDecisions(keywordQuery, textNewest)] : []),
    ]),
  ]);

  const failedKinds = [
    statutes.failed && "법령",
    ordinances.failed && "조례",
    (precedents.failed || constitutional.failed) && "판례",
    interpretations.failed && "법령해석례",
    tribunals.failed && "행정심판례",
  ].filter(Boolean);
  if (failedKinds.length > 0) {
    notices.push(`법제처에서 ${failedKinds.join("·")} 일부를 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.`);
  }

  const relevant = <T extends { title: string }>(items: T[]): T[] => items.filter((i) => matchesTerms(i.title, terms));
  const results: SearchResults = {
    statutes: relevant(statutes.items).slice(0, MAX_PER_KIND),
    ordinances: preferLocalGov(relevant(ordinances.items), masked.localGov).slice(0, MAX_PER_KIND),
    // 법원 판례와 헌재 결정은 일련번호 체계가 달라 합칠 때 번호로 중복을 지우지 않는다.
    cases: relevant([...precedents.items, ...constitutional.items]).slice(0, MAX_PER_KIND),
    interpretations: relevant(interpretations.items).slice(0, MAX_PER_KIND),
    tribunals: relevant(tribunals.items).slice(0, MAX_PER_KIND),
  };

  const foundNothing = Object.values(results).every((list) => list.length === 0);
  return { maskedInput: masked, piiFindings: findings, terms, results, notices, foundNothing };
}

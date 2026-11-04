// PLAN 작업 12: 법제처 직접 검색 결과와 웹 단서로 확인된 자료를 합친다.
// 키가 없는 순수한 정리 도구라 화면과 서버 양쪽에서 쓸 수 있다.
//
// Design Ref: §4.1 — 확인된 자료만 목록에. 웹 단서로 확인된 자료는 이 사안과 관련된 실제 사례에서 찾은 것이라
//                   같은 종류 안에서 앞에 둔다. 같은 자료는 한 번만.
import type { CaseItem, InterpretationItem, LawItem, TribunalItem, VerifiedItem } from "./types";

/** 자료 종류별 목록 */
export interface SearchResults {
  statutes: LawItem[]; // 법률·시행령·시행규칙 등
  ordinances: LawItem[]; // 조례·규칙
  cases: CaseItem[]; // 법원 판례·헌법재판소 결정
  interpretations: InterpretationItem[]; // 법령해석례
  tribunals: TribunalItem[]; // 행정심판례
}

/** 종류별 최대 건수(웹 단서로 확인된 자료를 합친 뒤) */
export const MAX_MERGED_PER_KIND = 8;

/** 같은 자료인지 구분하는 열쇠(법령은 조문까지) */
export function resultKey(item: VerifiedItem): string {
  if (item.kind === "law") return `law:${item.source}:${item.id}:${item.article ?? ""}`;
  if (item.kind === "case") return `case:${item.source}:${item.id}`;
  return `${item.kind}:${item.id}`;
}

function mergeList<T extends VerifiedItem>(first: T[], rest: T[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...first, ...rest]) {
    const key = resultKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/** 웹 단서로 확인된 자료(verified)를 종류별 목록 앞쪽에 합친다 */
export function mergeVerified(results: SearchResults, verified: VerifiedItem[], max = MAX_MERGED_PER_KIND): SearchResults {
  const laws = verified.filter((v): v is LawItem => v.kind === "law");
  return {
    statutes: mergeList(laws.filter((l) => l.source === "law"), results.statutes, max),
    ordinances: mergeList(laws.filter((l) => l.source === "ordin"), results.ordinances, max),
    cases: mergeList(verified.filter((v): v is CaseItem => v.kind === "case"), results.cases, max),
    interpretations: mergeList(
      verified.filter((v): v is InterpretationItem => v.kind === "interpretation"),
      results.interpretations,
      max,
    ),
    tribunals: mergeList(verified.filter((v): v is TribunalItem => v.kind === "tribunal"), results.tribunals, max),
  };
}

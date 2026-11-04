// PLAN 작업 12: 웹 단서를 법제처에서 다시 조회해 "확인된 자료"와 "검증 실패 항목"으로 나눈다.
//
// PRD 5번 A — 법제처 조회 결과로 확인된 것만 목록에 올린다. 확인되지 않은 항목은 근거로 쓰지 않고
//            목록에서 빼서, 접어 둔 "검증 실패 항목"으로 따로 표시한다.
// PRD 5번 A — 판례는 사건번호·법원·선고일, 해석례는 안건번호·회신일, 행정심판례는 사건번호·재결일이
//            모두 맞아야 확인된 것으로 본다(cases.ts·rulings.ts의 판정을 그대로 쓴다).
// PRD 5번 A — 법령 조문은 현행 법령 본문에 그 조문이 있어야 하고, 아직 시행 전인 조문은 근거로 쓰지 않는다.
//
// 이 파일은 서버 전용이다.
import { findCaseByClue } from "./cases";
import type { LawApiResult } from "./law-api";
import { findArticle, getStatute, searchStatutes, type LawDocument } from "./laws";
import { resultKey } from "./results";
import { findRulingByClue } from "./rulings";
import type { VerifiedItem } from "./types";
import type { WebClue } from "./web-clues";

/** 확인되지 않은 단서와 그 이유 */
export interface FailedClue {
  clue: WebClue;
  reason: string; // 사용자에게 보여줄 이유
}

export interface ClueVerification {
  verified: VerifiedItem[]; // 법제처에서 확인된 자료(법제처 정보로 채움, 웹 정보는 쓰지 않음)
  failed: FailedClue[]; // 확인되지 않은 단서
}

export const FAIL_REASONS = {
  notFound: "법제처에서 번호·날짜가 모두 일치하는 자료를 찾지 못했습니다.",
  lawNotFound: "현행 법령 중 같은 이름의 법령을 찾지 못했습니다.",
  articleNotFound: "현행 법령 본문에 해당 조문이 없습니다(개정·삭제되었거나 번호가 다를 수 있음).",
  notYetEffective: "아직 시행되지 않은 조문입니다.",
  lookupFailed: "법제처 조회 중 문제가 생겨 확인하지 못했습니다.",
} as const;

/** 법령 이름 비교용: 띄어쓰기·가운뎃점 표기 차이를 없앤다 */
export function normalizeLawName(name: string): string {
  return name.replace(/\s+/g, "").replace(/[ㆍ·・]/g, "·").replace(/[「」]/g, "");
}

type Outcome = { item: VerifiedItem } | { reason: string };

async function verifyLawClue(
  clue: WebClue,
  docCache: Map<string, Promise<LawApiResult<LawDocument>>>,
): Promise<Outcome> {
  // 1) 현행 법령 중 이름이 정확히 같은 것을 찾는다.
  const found = await searchStatutes(clue.lawName, { display: 10 });
  if (!found.ok) return { reason: FAIL_REASONS.lookupFailed };
  const target = normalizeLawName(clue.lawName);
  const law = found.data.items.find((i) => i.isCurrent && normalizeLawName(i.title) === target);
  if (!law) return { reason: FAIL_REASONS.lawNotFound };

  // 2) 그 법령의 현행 본문에서 조문을 찾는다(같은 법령은 한 번만 가져온다).
  if (!docCache.has(law.id)) docCache.set(law.id, getStatute(law.id));
  const doc = await docCache.get(law.id)!;
  if (!doc.ok) return { reason: FAIL_REASONS.lookupFailed };
  const article = findArticle(doc.data, clue.article);
  if (!article) return { reason: FAIL_REASONS.articleNotFound };
  if (article.notYetEffective) return { reason: FAIL_REASONS.notYetEffective };

  return { item: { ...law, article: article.label, articleTitle: article.title } };
}

async function verifyOne(
  clue: WebClue,
  docCache: Map<string, Promise<LawApiResult<LawDocument>>>,
): Promise<Outcome> {
  if (clue.kind === "law") return verifyLawClue(clue, docCache);
  const result =
    clue.kind === "prec" || clue.kind === "detc"
      ? await findCaseByClue(clue)
      : await findRulingByClue(clue.kind, clue);
  if (!result.ok) return { reason: FAIL_REASONS.lookupFailed };
  return result.data ? { item: result.data } : { reason: FAIL_REASONS.notFound };
}

/** 단서들을 함께 검증한다. 같은 자료로 확인된 단서는 하나만 남긴다. */
export async function verifyClues(clues: WebClue[]): Promise<ClueVerification> {
  const docCache = new Map<string, Promise<LawApiResult<LawDocument>>>();
  const outcomes = await Promise.all(clues.map((clue) => verifyOne(clue, docCache)));

  const verified: VerifiedItem[] = [];
  const failed: FailedClue[] = [];
  const seen = new Set<string>();
  outcomes.forEach((outcome, i) => {
    if ("item" in outcome) {
      const key = resultKey(outcome.item);
      if (!seen.has(key)) {
        seen.add(key);
        verified.push(outcome.item);
      }
    } else {
      failed.push({ clue: clues[i], reason: outcome.reason });
    }
  });
  return { verified, failed };
}

// 판례 관련성 판단: 사건명(제목)이 아니라 판시사항·판결요지(내용)를 읽고 쟁점과 관련 있는 판례를 고른다.
//
// Design Ref: §1.2 원칙 1·3 — 후보는 모두 법제처 검색 결과이고, 판시사항·판결요지도 법제처 원문이다.
//   AI는 "고르기"만 하며, 고른 이유로 낸 구절이 그 판례의 판시사항·판결요지에 글자 그대로 있어야 남긴다.
//   (AI가 지어낸 판례 번호나 존재하지 않는 구절은 코드가 걸러 낸다.)
// PRD 5번 A — 관련 없는 자료를 줄이는 거름망을 제목 비교에서 내용 비교로 바꾼 것이다.
//
// 이 파일은 서버 전용이다.
import { z } from "zod";
import { askAiJson, keepGroundedSentences, type AiResult } from "./ai";
import type { CaseInput } from "./case-input";
import { getCase, type CaseDocument } from "./cases";
import type { CaseItem } from "./types";

/** AI에게 보여줄 후보 판례의 최대 건수(법원 판례와 헌재 결정을 합쳐) */
export const MAX_CANDIDATES = 24;
/** 후보마다 AI에게 주는 판시사항·판결요지의 길이 한도(글자 수) */
const MAX_EXCERPT_CHARS = 900;
/** 한 번에 동시에 법제처에 요청하는 건수 */
const FETCH_CHUNK = 8;

const EXCERPT_HEADINGS = ["판시사항", "판결요지", "결정요지"];

/** 후보를 구분하는 열쇠. 법원 판례와 헌재 결정은 번호 체계가 달라 출처까지 붙인다. */
export function candidateKey(item: Pick<CaseItem, "source" | "id">): string {
  return `${item.source}:${item.id}`;
}

/** 판결문에서 판시사항·판결요지(결정요지)만 뽑아 길이를 제한한다. 없으면 빈 글. */
export function candidateExcerpt(doc: Pick<CaseDocument, "sections">): string {
  return doc.sections
    .filter((s) => EXCERPT_HEADINGS.includes(s.heading))
    .map((s) => `【${s.heading}】 ${s.text.replace(/\s+/g, " ").slice(0, MAX_EXCERPT_CHARS)}`)
    .join("\n");
}

const pickSchema = z.object({
  picks: z.array(
    z.object({
      key: z.string().describe("고른 판례의 자료 번호(목록에 적힌 그대로)"),
      quote: z.string().describe("그 판례의 판시사항·판결요지에서 글자 그대로 복사한 구절(쟁점과 관련 있는 부분)"),
      reason: z.string().describe("쟁점과 어떻게 관련되는지 한 문장"),
    }),
  ),
});

/**
 * AI가 고른 판례 중, 목록에 있는 것이고 근거 구절이 그 판례의 발췌문에 글자 그대로 있는 것만 남긴다.
 * 순서는 AI가 고른 순서(관련 높은 순)를 지키고, 같은 판례는 한 번만 남긴다.
 */
export function verifyPicks(
  picks: { key: string; quote: string; reason: string }[],
  excerpts: Record<string, string>,
  max: number,
): string[] {
  const asSentences = picks.map((p) => ({ text: p.reason, quote: p.quote, sourceId: p.key }));
  const { kept } = keepGroundedSentences(asSentences, excerpts);
  const keys: string[] = [];
  for (const s of kept) {
    if (!keys.includes(s.sourceId)) keys.push(s.sourceId);
    if (keys.length >= max) break;
  }
  return keys;
}

async function fetchExcerpts(candidates: CaseItem[]): Promise<Record<string, string>> {
  const excerpts: Record<string, string> = {};
  for (let i = 0; i < candidates.length; i += FETCH_CHUNK) {
    const chunk = candidates.slice(i, i + FETCH_CHUNK);
    const docs = await Promise.all(chunk.map((c) => getCase(c.source, c.id)));
    docs.forEach((d, k) => {
      if (!d.ok) return;
      const excerpt = candidateExcerpt(d.data);
      if (excerpt) excerpts[candidateKey(chunk[k])] = excerpt;
    });
  }
  return excerpts;
}

/**
 * 후보 판례 중 쟁점과 내용이 관련 있는 것만 고른다.
 * 판시사항·판결요지를 가져오지 못한 후보는 판단할 수 없으므로 제외한다.
 * 실패하면 호출한 쪽이 제목 비교로 대신하도록 실패로 돌려준다.
 */
export async function selectRelevantCases(
  candidates: CaseItem[],
  input: Pick<CaseInput, "facts" | "issue" | "field">,
  max: number,
): Promise<AiResult<CaseItem[]>> {
  const pool = candidates.slice(0, MAX_CANDIDATES);
  if (pool.length === 0) return { ok: true, data: [] };

  const excerpts = await fetchExcerpts(pool);
  const readable = pool.filter((c) => excerpts[candidateKey(c)]);
  if (readable.length === 0) return { ok: true, data: [] };

  const listing = readable
    .map((c) => `[자료 번호: ${candidateKey(c)}] ${c.court} ${c.caseNumber} ${c.title}\n${excerpts[candidateKey(c)]}`)
    .join("\n\n");

  const result = await askAiJson({
    instructions: [
      "[사안]과 [쟁점]을 읽고, [판례 목록]의 판시사항·판결요지만 보고 쟁점과 직접 관련 있는 판례를 고른다.",
      `관련성이 높은 순서로 최대 ${max}개까지 고른다. 쟁점과 같은 법적 문제(예: 어떤 토지가 건물의 부지에 해당하는지)를 다룬 판례만 고른다.`,
      "사건명이나 기억으로 판단하지 않는다. 목록에 적힌 판시사항·판결요지에 쟁점과 관련된 내용이 있을 때만 고른다.",
      "고른 판례마다 key(자료 번호, 목록에 적힌 그대로), quote(그 판례의 판시사항·판결요지에서 글자 그대로 복사한 8자 이상의 구절), reason(한 문장)을 쓴다.",
      "관련 있는 판례가 없으면 빈 목록으로 답한다. 억지로 고르지 않는다.",
    ].join("\n"),
    input: [`[사안]\n${input.facts}`, `[쟁점]\n${input.issue}`, input.field ? `[관련 분야]\n${input.field}` : "", `[판례 목록]\n${listing}`]
      .filter(Boolean)
      .join("\n\n"),
    schema: pickSchema,
    schemaName: "relevant_cases",
  });
  if (!result.ok) return result;

  const byKey = new Map(readable.map((c) => [candidateKey(c), c]));
  const keys = verifyPicks(result.data.picks, excerpts, max);
  return { ok: true, data: keys.map((k) => byKey.get(k)).filter((c): c is CaseItem => c !== undefined) };
}

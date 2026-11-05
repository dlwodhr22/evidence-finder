// 판례 관련성 판단: 사건명(제목)이 아니라 판시사항·판결요지와 본문 중 쟁점 부분(내용)을 읽고 쟁점과 관련 있는 판례를 고른다.
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
/** 후보마다 AI에게 주는 판시사항·판결요지 한 칸의 길이 한도(글자 수) */
const MAX_SUMMARY_CHARS = 600;
/** 본문에서 쟁점 표현 앞뒤로 잘라 보여주는 길이(글자 수) */
const WINDOW_BEFORE = 250;
const WINDOW_AFTER = 350;
const MAX_WINDOWS = 2;
/** 쟁점 표현이 본문에 없고 판시사항·판결요지도 없을 때 보여줄 이유 첫 부분 길이 */
const REASONS_HEAD_CHARS = 700;
/** 한 번에 동시에 법제처에 요청하는 건수 */
const FETCH_CHUNK = 8;

const EXCERPT_HEADINGS = ["판시사항", "판결요지", "결정요지"];
const BODY_HEADINGS = ["판례내용", "전문"];

/** 후보를 구분하는 열쇠. 법원 판례와 헌재 결정은 번호 체계가 달라 출처까지 붙인다. */
export function candidateKey(item: Pick<CaseItem, "source" | "id">): string {
  return `${item.source}:${item.id}`;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * 본문(판례내용·전문)에서 쟁점 표현이 나오는 곳 앞뒤를 잘라 온다(최대 2곳).
 * 주문·청구취지보다 법원의 판단을 보려고 "이유" 뒤에서 먼저 찾는다.
 * 잘라 온 글은 원문을 줄바꿈만 정리한 그대로다(근거 구절 확인에 쓴다).
 */
export function bodyWindows(body: string, hints: string[]): string[] {
  const text = oneLine(body);
  const reasons = text.search(/【\s*이\s*유\s*】|\s이\s유\s/);
  const from = reasons >= 0 ? reasons : 0;
  const spans: [number, number][] = [];
  for (const hint of hints) {
    const h = oneLine(hint);
    if (h.length < 2) continue;
    let i = text.indexOf(h, from);
    if (i < 0) i = text.indexOf(h);
    if (i < 0) continue;
    const span: [number, number] = [Math.max(0, i - WINDOW_BEFORE), Math.min(text.length, i + h.length + WINDOW_AFTER)];
    // 이미 잡은 곳과 겹치면 넓히기만 한다.
    const overlap = spans.find(([a, b]) => span[0] <= b && span[1] >= a);
    if (overlap) {
      overlap[0] = Math.min(overlap[0], span[0]);
      overlap[1] = Math.max(overlap[1], span[1]);
    } else if (spans.length < MAX_WINDOWS) {
      spans.push(span);
    }
  }
  return spans.sort((a, b) => a[0] - b[0]).map(([a, b]) => text.slice(a, b));
}

/**
 * 후보 판례를 AI가 판단할 수 있게 발췌한다:
 * 판시사항·판결요지(결정요지)와, 본문에서 쟁점 표현이 나오는 부분.
 * 하급심처럼 판시사항이 없는 판결도 본문으로 판단할 수 있게 한다. 아무것도 없으면 빈 글.
 */
export function candidateExcerpt(doc: Pick<CaseDocument, "sections">, hints: string[] = []): string {
  const parts = doc.sections
    .filter((s) => EXCERPT_HEADINGS.includes(s.heading))
    .map((s) => `【${s.heading}】 ${oneLine(s.text).slice(0, MAX_SUMMARY_CHARS)}`);
  const body = doc.sections.find((s) => BODY_HEADINGS.includes(s.heading));
  if (body) {
    const windows = bodyWindows(body.text, hints);
    if (windows.length > 0) {
      parts.push(`【본문 일부】 ${windows.join(" … ")}`);
    } else if (parts.length === 0) {
      const text = oneLine(body.text);
      const reasons = text.search(/【\s*이\s*유\s*】|\s이\s유\s/);
      parts.push(`【본문 일부】 ${text.slice(Math.max(0, reasons), Math.max(0, reasons) + REASONS_HEAD_CHARS)}`);
    }
  }
  return parts.join("\n");
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

async function fetchExcerpts(candidates: CaseItem[], hints: string[]): Promise<Record<string, string>> {
  const excerpts: Record<string, string> = {};
  for (let i = 0; i < candidates.length; i += FETCH_CHUNK) {
    const chunk = candidates.slice(i, i + FETCH_CHUNK);
    const docs = await Promise.all(chunk.map((c) => getCase(c.source, c.id)));
    docs.forEach((d, k) => {
      if (!d.ok) return;
      const excerpt = candidateExcerpt(d.data, hints);
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
  hints: string[],
  max: number,
): Promise<AiResult<CaseItem[]>> {
  const pool = candidates.slice(0, MAX_CANDIDATES);
  if (pool.length === 0) return { ok: true, data: [] };

  const excerpts = await fetchExcerpts(pool, hints);
  const readable = pool.filter((c) => excerpts[candidateKey(c)]);
  if (readable.length === 0) return { ok: true, data: [] };

  const listing = readable
    .map((c) => `[자료 번호: ${candidateKey(c)}] ${c.court} ${c.caseNumber} ${c.title}\n${excerpts[candidateKey(c)]}`)
    .join("\n\n");

  const result = await askAiJson({
    instructions: [
      "[사안]과 [쟁점]을 읽고, [판례 목록]에 적힌 판시사항·판결요지·본문 일부만 보고 쟁점에 대해 법원이 판단한 판례를 고른다.",
      `관련성이 높은 순서로 최대 ${max}개까지 고른다. 쟁점과 같은 법적 문제(예: 쟁점이 건물부지 판단이면, 어디까지가 건물의 부지인지·누가 부지를 점용하는지)를 법원이 판단한 판례만 고른다.`,
      "같은 법률(예: 국유재산법 변상금)을 다뤘더라도 쟁점과 다른 문제(예: 점유 권원, 시효, 산정 방식)만 판단한 판례는 고르지 않는다.",
      "사건명이나 기억으로 판단하지 않는다. 목록에 적힌 글에 쟁점에 대한 법원의 판단이 있을 때만 고른다.",
      "고른 판례마다 key(자료 번호, 목록에 적힌 그대로), quote(그 판례 글에서 쟁점에 대한 판단이 담긴 부분을 글자 그대로 복사한 15자 이상의 구절), reason(한 문장)을 쓴다.",
      "관련 있는 판례가 없으면 빈 목록으로 답한다. 억지로 채우지 않는다.",
    ].join("\n"),
    input: [`[사안]\n${input.facts}`, `[쟁점]\n${input.issue}`, input.field ? `[관련 분야]\n${input.field}` : "", `[판례 목록]\n${listing}`]
      .filter(Boolean)
      .join("\n\n"),
    schema: pickSchema,
    schemaName: "relevant_cases",
    tier: "strong", // 관련성 판단은 결과 품질을 크게 좌우하므로 큰 모델로 한다.
  });
  if (!result.ok) return result;

  const byKey = new Map(readable.map((c) => [candidateKey(c), c]));
  const keys = verifyPicks(result.data.picks, excerpts, max);
  return { ok: true, data: keys.map((k) => byKey.get(k)).filter((c): c is CaseItem => c !== undefined) };
}

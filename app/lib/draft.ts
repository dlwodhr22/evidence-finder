// PLAN 작업 18: 선택한 판단 후보로 공문 형식(제목, 경위, 검토 결과, 회신 내용) 회신 초안을 만든다.
// CLAUDE.md §4-8·9 — 초안임을 표시하고, 고른 자료만 근거로 쓴다. 모든 문장에 원문 구절을 붙이고 코드가 확인한다.
// 경위는 법령 원문이 아니라 입력한 사안에서만 가져온다(사안에 없는 사실을 지어내지 않기 위해).
//
// 서버 전용 파일이다.
import { z } from "zod";
import { askAiJson, groundedSentenceSchema, keepGroundedSentences, type GroundedSentence } from "./ai";
import { caseInputSchema, maskCaseInput, type CaseInput } from "./case-input";
import { candidatesRequestSchema, loadSources } from "./candidates";
import type { CandidateSource } from "./candidate-types";
import type { DocumentRef } from "./document-types";
import { CASE_SOURCE_ID, type DraftSentence, type DraftView } from "./draft-types";

const MAX_BACKGROUND = 4;
const MAX_REVIEW = 6;
const MAX_REPLY = 5;

// ── 요청 검사 ─────────────────────────────────────────────

const pointSchema = z.object({ text: z.string().max(1000), quote: z.string().max(2000), sourceId: z.string().max(10) });
const candidateSchema = z.object({
  title: z.string().max(500),
  reasons: z.array(pointSchema).max(10),
  counterpoints: z.array(pointSchema).max(10),
});
const sentenceInputSchema = pointSchema;

export const draftRequestSchema = z.object({
  input: caseInputSchema,
  picks: candidatesRequestSchema.shape.picks,
  /** 사용자가 고른 판단 후보(출처 정보는 믿지 않고 서버가 원문에서 다시 확인한다) */
  candidate: candidateSchema,
  /** 근거 없는 내용 신고일 때 화면에 있던 초안. 있으면 문장마다 다시 대조한다. */
  shown: z
    .object({
      title: z.string().max(300),
      background: z.array(sentenceInputSchema).max(10),
      review: z.array(sentenceInputSchema).max(10),
      reply: z.array(sentenceInputSchema).max(10),
    })
    .optional(),
});
export type DraftRequest = z.infer<typeof draftRequestSchema>;

// ── 검증 ──────────────────────────────────────────────────

const aiDraftSchema = z.object({
  title: z.string().describe("공문 제목. 예: '○○ 변상금 부과 이의 신청에 대한 회신'"),
  background: z.array(groundedSentenceSchema).max(MAX_BACKGROUND).describe("경위: 입력한 사안의 사실만. sourceId는 'case'"),
  review: z.array(groundedSentenceSchema).max(MAX_REVIEW).describe("검토 결과: 고른 자료의 내용에 근거한 문장"),
  reply: z.array(groundedSentenceSchema).max(MAX_REPLY).describe("회신 내용: 선택한 판단 후보의 방향에 따른 회신 문장"),
});

/** 문장마다 근거 구절이 해당 원문에 글자 그대로 있는 것만 남긴다 */
export function groundDraft(
  raw: { title: string; background: GroundedSentence[]; review: GroundedSentence[]; reply: GroundedSentence[] },
  texts: Record<string, string>,
  sources: Record<string, CandidateSource>,
): DraftView | null {
  let droppedCount = 0;
  const used = new Set<string>();
  const keep = (sentences: GroundedSentence[], allow: (id: string) => boolean): DraftSentence[] => {
    const { kept, dropped } = keepGroundedSentences(
      sentences.filter((s) => s.text.trim() !== "" && allow(s.sourceId)),
      texts,
    );
    droppedCount += dropped.length + sentences.filter((s) => s.text.trim() !== "" && !allow(s.sourceId)).length;
    return kept.flatMap((s) => {
      const source = sources[s.sourceId];
      if (!source) return [];
      if (s.sourceId !== CASE_SOURCE_ID) used.add(s.sourceId);
      return [{ text: s.text.trim(), quote: s.quote.trim(), source }];
    });
  };

  // 경위는 사안에서만, 검토 결과·회신 내용은 고른 법제처 자료에서만 근거를 댈 수 있다.
  const background = keep(raw.background, (id) => id === CASE_SOURCE_ID);
  const review = keep(raw.review, (id) => id !== CASE_SOURCE_ID);
  const reply = keep(raw.reply, (id) => id !== CASE_SOURCE_ID);

  // 검토 결과와 회신 내용이 비면 초안으로 쓸 수 없다.
  if (review.length === 0 || reply.length === 0 || raw.title.trim() === "") return null;
  return {
    title: raw.title.trim(),
    background,
    review,
    reply,
    sources: [...used].sort().map((id) => sources[id]),
    droppedCount,
  };
}

// ── 초안 만들기 ───────────────────────────────────────────

type DraftResult = { ok: true; data: DraftView; regenerated?: boolean } | { ok: false; code: "SOURCE_UNAVAILABLE" | "AI_FAILED" | "NO_GROUNDED_DRAFT"; message: string };

export async function buildDraft(req: DraftRequest, picks: DocumentRef[]): Promise<DraftResult> {
  const { masked } = maskCaseInput(req.input as CaseInput);

  const loaded = await loadSources(picks);
  if (!loaded.ok) return { ok: false, code: "SOURCE_UNAVAILABLE", message: loaded.message };
  const sources: Record<string, CandidateSource> = {
    ...loaded.sources,
    [CASE_SOURCE_ID]: { id: CASE_SOURCE_ID, title: "입력한 사안", citation: "담당자가 입력한 사안", sourceUrl: "" },
  };
  const caseText = `${masked.facts}\n${masked.issue}`;
  const texts: Record<string, string> = { ...loaded.texts, [CASE_SOURCE_ID]: caseText };

  // 근거 없는 내용 신고: 화면에 있던 초안을 문장마다 다시 대조한다. 필수 부분이 남으면 그대로 돌려준다.
  if (req.shown) {
    const toG = (xs: z.infer<typeof sentenceInputSchema>[]): GroundedSentence[] => xs.map((x) => ({ text: x.text, quote: x.quote, sourceId: x.sourceId }));
    const rechecked = groundDraft({ title: req.shown.title, background: toG(req.shown.background), review: toG(req.shown.review), reply: toG(req.shown.reply) }, texts, sources);
    if (rechecked) return { ok: true, data: rechecked };
    // 남은 것이 부족하면 아래에서 처음부터 다시 만든다.
  }

  // 판단 후보의 근거도 원문과 다시 대조한다(화면 값을 믿지 않는다). 하나도 남지 않으면 만들지 않는다.
  const toG = (xs: z.infer<typeof pointSchema>[]): GroundedSentence[] => xs.map((x) => ({ text: x.text, quote: x.quote, sourceId: x.sourceId }));
  const reasons = keepGroundedSentences(toG(req.candidate.reasons), loaded.texts).kept;
  const counter = keepGroundedSentences(toG(req.candidate.counterpoints), loaded.texts).kept;
  if (reasons.length === 0) {
    return { ok: false, code: "NO_GROUNDED_DRAFT", message: "선택한 후보의 근거를 법제처 원문에서 다시 확인하지 못했습니다. 판단 후보를 다시 만들어 주세요." };
  }

  const material = Object.keys(loaded.sources)
    .map((id) => `[자료 ${id}] ${sources[id].title} (${sources[id].citation})\n${texts[id]}`)
    .join("\n\n---\n\n");

  const ai = await askAiJson({
    instructions: [
      "민원에 대한 회신 초안을 공문 형식으로 쓴다. 문체는 공문서의 존대('~하였습니다', '~바랍니다').",
      "title은 공문 제목, background는 경위, review는 검토 결과, reply는 회신 내용이다.",
      `background(경위)는 [사안]의 사실만 쓰고, 근거 구절(quote)은 [사안]에서 글자 그대로 복사하며 sourceId는 "${CASE_SOURCE_ID}"로 쓴다.`,
      "review(검토 결과)와 reply(회신 내용)는 [자료]의 내용에만 근거하고, quote는 [자료]에서 글자 그대로 복사하며 sourceId는 그 자료 번호(예: s1)로 쓴다.",
      "[선택한 판단 후보]의 방향을 따르되, [엇갈리는 근거]가 있으면 review에 함께 적는다. 숨기지 않는다.",
      "중요: quote는 반드시 [자료] 또는 [사안]의 본문에서 복사한다. [선택한 판단 후보]·[엇갈리는 근거]의 문장은 quote로 쓰지 않는다. 대신 각 근거 문장 뒤에 적힌 '근거 원문' 구절은 quote로 그대로 써도 된다.",
      "quote는 한 문장 이상을 한 글자도 바꾸지 말고 복사한다. 요약하거나 말을 바꾸면 그 문장은 버려진다.",
      "[자료]·[사안]에 없는 법령·판례·사실·날짜·금액은 쓰지 않는다. 이름·연락처 등 개인정보는 쓰지 않고 '민원인'으로 쓴다.",
      "최종 결론을 단정하지 않고 '~로 판단됩니다' 정도로 쓴다. 근거가 부족하면 문장을 줄인다.",
    ].join("\n"),
    input: [
      `[사안]\n${masked.facts}`,
      `[쟁점]\n${masked.issue}`,
      `[선택한 판단 후보]\n${req.candidate.title}\n뒷받침 근거:\n${reasons.map((r) => `- ${r.text}\n  근거 원문(${r.sourceId}): ${r.quote}`).join("\n")}`,
      counter.length ? `[엇갈리는 근거]\n${counter.map((r) => `- ${r.text}\n  근거 원문(${r.sourceId}): ${r.quote}`).join("\n")}` : "",
      `[자료]\n${material}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: aiDraftSchema,
    schemaName: "reply_draft",
  });
  if (!ai.ok) return { ok: false, code: "AI_FAILED", message: ai.error.message };

  const draft = groundDraft(ai.data, texts, sources);
  if (!draft) {
    return { ok: false, code: "NO_GROUNDED_DRAFT", message: "원문으로 뒷받침되는 회신 초안을 만들지 못했습니다. 근거로 쓸 자료를 더 고르거나 바꿔 다시 시도해 주세요." };
  }
  return { ok: true, data: draft, ...(req.shown ? { regenerated: true } : {}) };
}

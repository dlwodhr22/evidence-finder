// PLAN 작업 17: 사용자가 고른 자료만 근거로 판단 후보를 만든다.
// Design Ref: §4.3 — 선택한 자료(원문)만 → AI가 후보 작성(후보별 출처 필수) → 근거 구절이 원문에 없는 문장은 걸러냄.
// CLAUDE.md §4-8·9 — 판단은 확정하지 않고 후보로만. 근거가 엇갈리면 숨기지 않는다. 고르지 않은 자료는 끌어오지 않는다.
//
// 서버 전용 파일이다.
import { z } from "zod";
import { askAiJson, groundedSentenceSchema, keepGroundedSentences, type AiResult, type GroundedSentence } from "./ai";
import { maskCaseInput, caseInputSchema, type CaseInput } from "./case-input";
import type { Candidate, CandidatePoint, CandidateSource, CandidatesView } from "./candidate-types";
import { MAX_PICKS } from "./candidate-types";
import { loadDocument, parseDocumentRef } from "./document";
import type { DocumentRef } from "./document-types";

const MAX_CANDIDATES = 3;
const TOTAL_SOURCE_CHARS = 14_000; // 모든 자료 원문을 합쳐 AI에게 줄 수 있는 글자 수
const MAX_SOURCE_CHARS = 6_000; // 자료 한 건당 한도

// ── 요청 검사 ─────────────────────────────────────────────

const refSchema = z.object({
  kind: z.string().max(20),
  source: z.string().max(10).optional(),
  id: z.string().max(20),
  article: z.string().max(40).optional(),
});

export const candidatesRequestSchema = z.object({
  input: caseInputSchema,
  picks: z.array(refSchema).min(1, "근거로 쓸 자료를 하나 이상 골라 주세요.").max(MAX_PICKS, `근거는 ${MAX_PICKS}건까지 고를 수 있습니다.`),
});

/** 고른 자료 요청을 검사한다. 하나라도 알 수 없는 자료면 null. 같은 자료는 한 번만. */
export function parsePicks(raw: z.infer<typeof refSchema>[]): DocumentRef[] | null {
  const refs: DocumentRef[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const ref = parseDocumentRef(r);
    if (!ref) return null;
    // 법령은 조문까지 정해야 근거로 쓸 수 있다(법 전체는 근거가 되기에 범위가 넓다).
    if (ref.kind === "law" && !ref.article) return null;
    const key = `${ref.kind}:${ref.source ?? ""}:${ref.id}:${ref.article ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

// ── AI 답 검증 ────────────────────────────────────────────

const aiCandidateSchema = z.object({
  title: z.string().describe("판단 후보를 한 문장으로. 결론을 확정하는 말투(~이다)가 아니라 '~로 볼 여지가 있음'처럼 쓴다."),
  reasons: z.array(groundedSentenceSchema).max(5).describe("이 후보를 뒷받침하는 근거 문장"),
  counterpoints: z.array(groundedSentenceSchema).max(3).describe("이 후보와 엇갈리거나 불리한 근거 문장. 없으면 빈 목록"),
});
const aiOutputSchema = z.object({ candidates: z.array(aiCandidateSchema).max(MAX_CANDIDATES) });
type AiCandidate = z.infer<typeof aiCandidateSchema>;

/**
 * AI가 낸 후보에서 근거 구절이 해당 자료 원문에 글자 그대로 있는 문장만 남긴다.
 * 근거 문장이 하나도 남지 않은 후보는 통째로 뺀다.
 */
export function groundCandidates(
  raw: AiCandidate[],
  texts: Record<string, string>,
  sources: Record<string, CandidateSource>,
): { candidates: Candidate[]; droppedCount: number } {
  let droppedCount = 0;
  const toPoints = (sentences: GroundedSentence[]): CandidatePoint[] => {
    const { kept, dropped } = keepGroundedSentences(
      sentences.filter((s) => s.text.trim() !== ""),
      texts,
    );
    droppedCount += dropped.length;
    return kept.flatMap((s) => {
      const source = sources[s.sourceId];
      return source ? [{ text: s.text.trim(), quote: s.quote.trim(), source }] : [];
    });
  };

  const candidates: Candidate[] = [];
  for (const c of raw) {
    const reasons = toPoints(c.reasons);
    const counterpoints = toPoints(c.counterpoints);
    if (reasons.length === 0) {
      droppedCount += counterpoints.length; // 뒷받침 없는 후보는 반대 근거도 함께 버린다
      continue;
    }
    if (c.title.trim() === "") continue;
    candidates.push({ title: c.title.trim(), reasons, counterpoints });
  }
  return { candidates, droppedCount };
}

// ── 후보 만들기 ───────────────────────────────────────────

type CandidateResult = { ok: true; data: CandidatesView } | { ok: false; code: "SOURCE_UNAVAILABLE" | "AI_FAILED"; message: string };

/** 고른 자료의 법제처 원문을 가져와 번호(s1, s2…)를 붙인다. 후보·초안이 같은 방식으로 쓴다. */
export type LoadedSources =
  | { ok: true; sources: Record<string, CandidateSource>; texts: Record<string, string>; excluded: CandidatesView["excluded"] }
  | { ok: false; message: string };

export async function loadSources(picks: DocumentRef[]): Promise<LoadedSources> {
  // 하나라도 못 가져오면 만들지 않는다.
  const loaded = await Promise.all(picks.map((ref) => loadDocument(ref)));
  const sources: Record<string, CandidateSource> = {};
  const texts: Record<string, string> = {};
  const excluded: CandidatesView["excluded"] = [];
  const perSource = Math.min(MAX_SOURCE_CHARS, Math.floor(TOTAL_SOURCE_CHARS / picks.length));

  for (let i = 0; i < loaded.length; i++) {
    const result = loaded[i];
    if (!result.ok) {
      return { ok: false, message: "고른 자료의 법제처 원문을 가져오지 못해 만들지 않았습니다. 잠시 뒤 다시 시도해 주세요." };
    }
    const { view, fullText } = result.data;
    if (view.notYetEffective) {
      excluded.push({ title: view.title, reason: "아직 시행 전인 조문이라 근거로 쓰지 않았습니다." });
      continue;
    }
    const id = `s${i + 1}`;
    sources[id] = { id, title: view.title, citation: view.citation, sourceUrl: view.sourceUrl };
    texts[id] = fullText.slice(0, perSource); // AI에게 준 범위와 확인하는 범위를 같게 둔다
  }

  if (Object.keys(sources).length === 0) {
    return { ok: false, message: "근거로 쓸 수 있는 자료가 없습니다(시행 전 조문만 고르셨을 수 있습니다)." };
  }
  return { ok: true, sources, texts, excluded };
}

export async function buildCandidates(rawInput: CaseInput, picks: DocumentRef[]): Promise<CandidateResult> {
  // 서버에서도 개인정보를 한 번 더 가린다.
  const { masked } = maskCaseInput(rawInput);

  // 1) 고른 자료의 법제처 원문을 가져온다.
  const loadedSources = await loadSources(picks);
  if (!loadedSources.ok) return { ok: false, code: "SOURCE_UNAVAILABLE", message: loadedSources.message };
  const { sources, texts, excluded } = loadedSources;
  const usable = Object.keys(sources);

  // 2) AI가 후보를 쓴다. 근거는 반드시 위 자료 원문 구절이어야 한다.
  const material = usable.map((id) => `[자료 ${id}] ${sources[id].title} (${sources[id].citation})\n${texts[id]}`).join("\n\n---\n\n");
  const ai: AiResult<z.infer<typeof aiOutputSchema>> = await askAiJson({
    instructions: [
      `[사안]과 [쟁점]에 대해 판단 후보를 ${MAX_CANDIDATES}개 이하로 제시한다. 서로 다른 방향의 판단이 가능하면 별개의 후보로 나눈다.`,
      "결론을 확정하지 않는다. 후보 제목은 '~로 볼 여지가 있음'처럼 후보임이 드러나게 쓴다.",
      "후보마다 reasons(뒷받침하는 근거 문장)를 쓰고, 각 문장에는 [자료]에서 글자 그대로 복사한 구절(quote)과 그 자료 번호(sourceId, 예: s1)를 붙인다.",
      "그 후보와 엇갈리거나 불리한 근거가 [자료]에 있으면 counterpoints에 같은 방식으로 쓴다. 숨기지 않는다.",
      "[자료]에 없는 법령·판례·조문·사실은 쓰지 않는다. 사안에 없는 사실을 지어내지 않는다. 근거가 부족하면 후보를 적게 낸다.",
    ].join("\n"),
    input: [`[사안]\n${masked.facts}`, `[쟁점]\n${masked.issue}`, masked.field ? `[관련 분야] ${masked.field}` : "", `[자료]\n${material}`]
      .filter(Boolean)
      .join("\n\n"),
    schema: aiOutputSchema,
    schemaName: "judgment_candidates",
    tier: "strong", // 법적 판단에 가까운 일은 큰 모델로
  });
  if (!ai.ok) return { ok: false, code: "AI_FAILED", message: ai.error.message };

  // 3) 근거 구절이 원문에 그대로 있는 문장만 남긴다.
  const grounded = groundCandidates(ai.data.candidates, texts, sources);

  return {
    ok: true,
    data: {
      candidates: grounded.candidates,
      sources: usable.map((id) => sources[id]),
      excluded,
      droppedCount: grounded.droppedCount,
    },
  };
}

// ── 근거 없는 내용 신고 → 문장마다 원문과 다시 대조 ──────────────────

const pointInputSchema = z.object({ text: z.string().max(1000), quote: z.string().max(2000), sourceId: z.string().max(10) });
export const candidatesRecheckSchema = z.object({
  input: caseInputSchema,
  picks: candidatesRequestSchema.shape.picks,
  /** 화면에 보이던 후보. 출처 정보는 믿지 않고 서버가 원문에서 다시 채운다. */
  candidates: z
    .array(z.object({ title: z.string().max(500), reasons: z.array(pointInputSchema).max(10), counterpoints: z.array(pointInputSchema).max(10) }))
    .max(MAX_CANDIDATES),
});

/**
 * 화면에 있던 후보를 법제처 원문과 문장마다 다시 대조해, 뒷받침되지 않는 문장을 빼고 돌려준다.
 * 하나도 남지 않으면 처음부터 다시 만든다.
 */
export async function recheckCandidates(
  rawInput: CaseInput,
  picks: DocumentRef[],
  shown: z.infer<typeof candidatesRecheckSchema>["candidates"],
): Promise<CandidateResult & { regenerated?: boolean }> {
  const loadedSources = await loadSources(picks);
  if (!loadedSources.ok) return { ok: false, code: "SOURCE_UNAVAILABLE", message: loadedSources.message };
  const { sources, texts, excluded } = loadedSources;

  const toGrounded = (points: z.infer<typeof pointInputSchema>[]): GroundedSentence[] => points.map((p) => ({ text: p.text, quote: p.quote, sourceId: p.sourceId }));
  const { candidates, droppedCount } = groundCandidates(
    shown.map((c) => ({ title: c.title, reasons: toGrounded(c.reasons), counterpoints: toGrounded(c.counterpoints) })),
    texts,
    sources,
  );
  if (candidates.length === 0) {
    const fresh = await buildCandidates(rawInput, picks);
    return fresh.ok ? { ...fresh, regenerated: true } : fresh;
  }
  return { ok: true, data: { candidates, sources: Object.values(sources), excluded, droppedCount } };
}

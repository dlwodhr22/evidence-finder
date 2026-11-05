// PLAN 작업 4: AI 호출을 한 파일에 모은다. 지금은 OpenAI를 쓴다.
// 나중에 다른 AI 서비스로 바꿀 때는 이 파일만 고치면 된다(CLAUDE.md 코딩 규칙).
//
// Design Ref: §1.2 원칙 2 — AI는 검색어 뽑기·웹검색 단서·원문 요약·판단 후보·초안 문장에만 쓴다.
// Design Ref: §1.2 원칙 3 — AI 문장은 근거 원문 구절을 함께 내게 하고, 그 구절이 원문에
//                         글자 그대로 있는지를 코드가 확인한다(keepGroundedSentences).
// Design Ref: §10 보안 — OPENAI_API_KEY는 서버에서만 읽고, 오류 내용에 섞여 나가지 않게 한다.
//
// 이 파일은 서버 전용이다. 화면 조각(components)에서 직접 불러 쓰지 않는다.
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

// 기본 모델. .env에 OPENAI_MODEL을 넣으면 그 모델을 쓴다.
const DEFAULT_MODEL = "gpt-4o-mini";
// 판단 후보·회신 초안처럼 법적 판단에 가까운 일은 더 큰 모델로 한다. .env에 OPENAI_MODEL_STRONG을 넣으면 그 모델을 쓴다.
const DEFAULT_STRONG_MODEL = "gpt-4.1";

/** 어떤 모델을 쓸지: light = 요약·검색어·웹 단서(비용 절약), strong = 판단 후보·회신 초안(정확도) */
export type ModelTier = "light" | "strong";

function pickModel(tier: ModelTier | undefined): string {
  if (tier === "strong") return process.env.OPENAI_MODEL_STRONG?.trim() || DEFAULT_STRONG_MODEL;
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}
const TIMEOUT_MS = 60_000;
const WEB_SEARCH_TIMEOUT_MS = 90_000; // 웹검색은 여러 페이지를 열어 보느라 더 오래 걸린다

/** 오류 종류 */
export type AiErrorCode =
  | "MISSING_KEY" // .env에 OPENAI_API_KEY가 없음
  | "TIMEOUT" // 정해진 시간 안에 답이 없음
  | "API_ERROR" // AI 서비스가 오류로 답함(키 오류·사용량 초과 등)
  | "REFUSAL" // AI가 답하기를 거절함
  | "BAD_OUTPUT"; // 약속한 모양이 아닌 답

export interface AiError {
  code: AiErrorCode;
  message: string; // 사용자에게 보여줄 한국어 설명
}

/** 모든 AI 호출은 성공 또는 실패 중 하나의 모양으로 돌아온다(law-api와 같은 모양) */
export type AiResult<T> = { ok: true; data: T } | { ok: false; error: AiError };

const MESSAGES: Record<AiErrorCode, string> = {
  MISSING_KEY: "AI 서비스 키(OPENAI_API_KEY)가 설정되지 않았습니다.",
  TIMEOUT: "AI 응답이 너무 늦어 중단했습니다. 잠시 뒤 다시 시도해 주세요.",
  API_ERROR: "AI 서비스가 오류로 답했습니다. 잠시 뒤 다시 시도해 주세요.",
  REFUSAL: "AI가 이 요청에 답하지 않았습니다.",
  BAD_OUTPUT: "AI 답이 약속한 형식이 아니어서 쓰지 않았습니다.",
};

function fail(code: AiErrorCode): { ok: false; error: AiError } {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

// AI 연결은 한 번만 만들어 다시 쓴다.
let client: OpenAI | null = null;
function getClient(apiKey: string): OpenAI {
  if (!client) client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  return client;
}

// 모든 요청에 공통으로 붙이는 기본 규칙(PRD의 AI가 지킬 규칙 중 공통 부분)
const BASE_RULES = [
  "너는 한국 공무원의 대민업무를 돕는 도우미다. 모든 답은 한국어로 쓴다.",
  "주어진 자료에 없는 법령·판례·사건번호·조문을 기억으로 만들어 내지 않는다.",
  "확실하지 않으면 지어내지 말고, 모른다고 답하거나 해당 칸을 비운다.",
  "결론을 확정하지 않는다.",
].join("\n");

export interface AskJsonRequest<T> {
  /** 이번 요청에만 쓰는 지시 */
  instructions: string;
  /** AI에게 줄 내용(사안, 원문 등) */
  input: string;
  /** 답의 모양을 정하는 Zod 규칙. AI 답은 이 모양으로만 받는다. */
  schema: z.ZodType<T>;
  /** 답 모양의 이름(영문·숫자·밑줄) */
  schemaName: string;
  /** 모델 등급. 비우면 light(가벼운 모델) */
  tier?: ModelTier;
}

/**
 * AI에게 묻고, 약속한 모양(JSON)으로만 답을 받는다.
 * 모양이 다르거나 거절하면 실패로 돌려준다.
 */
export async function askAiJson<T>(req: AskJsonRequest<T>): Promise<AiResult<T>> {
  if (typeof window !== "undefined") {
    // 브라우저에서 불리면 키가 드러날 수 있으므로 막는다.
    throw new Error("ai는 서버에서만 사용할 수 있습니다.");
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fail("MISSING_KEY");
  const model = pickModel(req.tier);

  try {
    const response = await getClient(apiKey).responses.parse({
      model,
      instructions: `${BASE_RULES}\n\n${req.instructions}`,
      input: req.input,
      text: { format: zodTextFormat(req.schema, req.schemaName) },
      store: false, // 사안 내용을 AI 서비스 쪽에 보관하지 않도록 요청한다(PRD 7번: 저장하지 않음)
    });

    // AI가 거절했는지 확인
    for (const item of response.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "refusal") return fail("REFUSAL");
        }
      }
    }

    // 라이브러리가 읽어 낸 답을 한 번 더 규칙으로 검사한다.
    const checked = req.schema.safeParse(response.output_parsed);
    if (!checked.success) return fail("BAD_OUTPUT");
    return { ok: true, data: checked.data };
  } catch (err) {
    // 오류 내용은 그대로 내보내지 않는다(요청 정보가 섞일 수 있음).
    if (err instanceof OpenAI.APIConnectionTimeoutError) return fail("TIMEOUT");
    if (err instanceof OpenAI.APIError) return fail("API_ERROR");
    return fail("BAD_OUTPUT");
  }
}

// ─────────────────────────────────────────────────────────────
// 웹검색을 함께 쓰는 요청 (PLAN 작업 11)
// ─────────────────────────────────────────────────────────────

/** AI가 웹검색으로 실제로 열어 본 페이지 */
export interface WebSource {
  url: string;
  title?: string; // 인용 표시(url_citation)에 제목이 있을 때만
}

/** 웹검색 응답에서 실제로 검색·인용된 페이지 주소를 모은다(AI가 쓴 글이 아니라 검색 기록에서) */
export function collectWebSources(output: unknown[]): WebSource[] {
  const byUrl = new Map<string, WebSource>();
  const add = (url: unknown, title?: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const prev = byUrl.get(url);
    const t = typeof title === "string" && title.trim() ? title.trim() : prev?.title;
    byUrl.set(url, t ? { url, title: t } : { url });
  };
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const it = item as Record<string, unknown>;
    // 1) 웹검색 기록: action.sources[].url
    if (it.type === "web_search_call" && typeof it.action === "object" && it.action !== null) {
      const sources = (it.action as { sources?: unknown }).sources;
      if (Array.isArray(sources)) for (const s of sources) add((s as { url?: unknown })?.url);
    }
    // 2) 답변 속 인용 표시: content[].annotations[] (type = url_citation)
    if (it.type === "message" && Array.isArray(it.content)) {
      for (const part of it.content as Record<string, unknown>[]) {
        if (!Array.isArray(part?.annotations)) continue;
        for (const a of part.annotations as Record<string, unknown>[]) {
          if (a?.type === "url_citation") add(a.url, a.title);
        }
      }
    }
  }
  return [...byUrl.values()];
}

export interface AskWithWebSearchRequest<T> extends AskJsonRequest<T> {
  /** 검색할 사이트를 이 주소들로 한정한다(예: ["go.kr"]). 비우면 제한 없음. */
  allowedDomains?: string[];
}

/**
 * AI가 웹검색을 하면서 답하게 하고, 약속한 모양(JSON)의 답과 실제로 검색된 페이지 목록을 함께 돌려준다.
 * 웹 문장은 화면에 쓰지 않는다. 이 결과는 단서 찾기에만 쓴다(PRD 5번 A).
 */
export async function askAiJsonWithWebSearch<T>(
  req: AskWithWebSearchRequest<T>,
): Promise<AiResult<{ answer: T; sources: WebSource[] }>> {
  if (typeof window !== "undefined") throw new Error("ai는 서버에서만 사용할 수 있습니다.");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fail("MISSING_KEY");
  const model = pickModel(req.tier);

  try {
    const response = await getClient(apiKey).responses.parse({
      model,
      instructions: `${BASE_RULES}\n\n${req.instructions}`,
      input: req.input,
      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
          user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" },
          ...(req.allowedDomains?.length ? { filters: { allowed_domains: req.allowedDomains } } : {}),
        },
      ],
      include: ["web_search_call.action.sources"],
      text: { format: zodTextFormat(req.schema, req.schemaName) },
      store: false,
    }, { timeout: WEB_SEARCH_TIMEOUT_MS });

    for (const item of response.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "refusal") return fail("REFUSAL");
        }
      }
    }

    const checked = req.schema.safeParse(response.output_parsed);
    if (!checked.success) return fail("BAD_OUTPUT");
    return { ok: true, data: { answer: checked.data, sources: collectWebSources(response.output) } };
  } catch (err) {
    if (err instanceof OpenAI.APIConnectionTimeoutError) return fail("TIMEOUT");
    if (err instanceof OpenAI.APIError) return fail("API_ERROR");
    return fail("BAD_OUTPUT");
  }
}

// ─────────────────────────────────────────────────────────────
// 원문 구절 확인 (환각 방지)
// ─────────────────────────────────────────────────────────────

/** AI가 쓴 문장 한 개와, 그 문장의 근거라며 내놓은 원문 구절 */
export interface GroundedSentence {
  text: string; // AI가 쓴 문장
  quote: string; // 근거가 된 원문 구절(원문에 글자 그대로 있어야 함)
  sourceId: string; // 어느 자료의 원문인지
}

/** 근거 구절을 함께 받기 위한 Zod 규칙. 요약·판단 후보·초안 요청에서 그대로 쓴다. */
export const groundedSentenceSchema = z.object({
  text: z.string().describe("AI가 쓴 문장"),
  quote: z.string().describe("이 문장의 근거가 되는 원문 구절. 원문에서 글자 그대로 복사한다."),
  sourceId: z.string().describe("근거 원문의 자료 번호"),
});

// 너무 짧은 구절("이다" 등)은 아무 원문에나 있으므로 근거로 인정하지 않는다.
const MIN_QUOTE_LENGTH = 8;

/** 줄바꿈·여러 칸 띄어쓰기 차이만 없애고 비교한다. 글자는 바꾸지 않는다. */
function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 문장마다 근거 구절이 해당 원문에 글자 그대로 있는지 확인한다.
 * 확인된 문장(kept)만 화면에 쓰고, 확인되지 않은 문장(dropped)은 버린다.
 * @param sources 자료 번호 → 원문 전체
 */
export function keepGroundedSentences(
  sentences: GroundedSentence[],
  sources: Record<string, string>,
): { kept: GroundedSentence[]; dropped: GroundedSentence[] } {
  const kept: GroundedSentence[] = [];
  const dropped: GroundedSentence[] = [];

  for (const sentence of sentences) {
    const source = sources[sentence.sourceId];
    const quote = normalizeSpaces(sentence.quote);
    const grounded =
      source !== undefined &&
      quote.length >= MIN_QUOTE_LENGTH &&
      normalizeSpaces(source).includes(quote);
    (grounded ? kept : dropped).push(sentence);
  }

  return { kept, dropped };
}

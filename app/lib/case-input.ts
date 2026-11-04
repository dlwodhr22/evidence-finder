// PLAN 작업 9: 사안 입력의 규칙(필수 항목·글자 수)과 개인정보 가림을 한곳에 모은다.
// 화면(입력 양식)과 서버(작업 10번의 검색) 양쪽에서 같은 규칙을 쓴다.
//
// Design Ref: §3.3 ① 사안 입력 — 사안 내용, 판단해야 할 쟁점, 관련 분야(+ 관련 지자체(선택)).
// Design Ref: §9 오류 처리 — 사안이 너무 짧으면 더 구체적으로 적도록 안내한다.
// PRD 7번 — 개인정보로 보이는 부분은 자동으로 가린 뒤 진행한다.
//
// 이 파일에는 키가 없어서 화면에서도 쓸 수 있다. 개인정보 가림은 화면에서 먼저 하고(보내기 전에 미리 가림),
// 서버에서도 한 번 더 한다(작업 10번).
import { z } from "zod";
import { maskPii, type PiiFinding, type PiiKind } from "./pii";

/** 입력 칸별 글자 수 제한 */
export const CASE_LIMITS = {
  facts: { min: 20, max: 2000 },
  issue: { min: 5, max: 300 },
  field: { max: 50 },
  localGov: { max: 30 },
} as const;

/** 입력 칸 이름표(화면에 보일 이름) */
export const CASE_LABELS = {
  facts: "사안 내용",
  issue: "판단해야 할 쟁점",
  field: "관련 분야",
  localGov: "관련 지자체",
} as const;

export type CaseField = keyof typeof CASE_LABELS;

/** 사안 입력 규칙 */
export const caseInputSchema = z.object({
  facts: z
    .string()
    .trim()
    .min(CASE_LIMITS.facts.min, `사안 내용을 ${CASE_LIMITS.facts.min}자 이상 구체적으로 적어 주세요. 언제, 무엇을, 왜 다투는지가 들어가면 좋습니다.`)
    .max(CASE_LIMITS.facts.max, `사안 내용은 ${CASE_LIMITS.facts.max}자까지 적을 수 있습니다.`),
  issue: z
    .string()
    .trim()
    .min(CASE_LIMITS.issue.min, `판단해야 할 쟁점을 ${CASE_LIMITS.issue.min}자 이상 적어 주세요. 예: 변상금 부과가 정당한지`)
    .max(CASE_LIMITS.issue.max, `쟁점은 ${CASE_LIMITS.issue.max}자까지 적을 수 있습니다.`),
  field: z
    .string()
    .trim()
    .max(CASE_LIMITS.field.max, `관련 분야는 ${CASE_LIMITS.field.max}자까지 적을 수 있습니다.`),
  localGov: z
    .string()
    .trim()
    .max(CASE_LIMITS.localGov.max, `관련 지자체는 ${CASE_LIMITS.localGov.max}자까지 적을 수 있습니다.`),
});

export type CaseInput = z.infer<typeof caseInputSchema>;

export type CaseInputErrors = Partial<Record<CaseField, string>>;

/** 입력을 검사한다. 통과하면 앞뒤 빈칸을 정리한 입력을, 아니면 칸별 오류 안내를 돌려준다. */
export function validateCaseInput(
  raw: unknown,
): { ok: true; data: CaseInput } | { ok: false; errors: CaseInputErrors } {
  const result = caseInputSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors: CaseInputErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in CASE_LABELS && !errors[field as CaseField]) {
      errors[field as CaseField] = issue.message;
    }
  }
  return { ok: false, errors };
}

/** 입력 칸마다 개인정보를 가리고, 무엇을 몇 개 가렸는지 합쳐서 돌려준다 */
export function maskCaseInput(input: CaseInput): { masked: CaseInput; findings: PiiFinding[] } {
  const totals = new Map<PiiKind, PiiFinding>();
  const masked = { ...input };
  for (const field of Object.keys(CASE_LABELS) as CaseField[]) {
    const { text, findings } = maskPii(input[field]);
    masked[field] = text;
    for (const f of findings) {
      const prev = totals.get(f.kind);
      totals.set(f.kind, { ...f, count: (prev?.count ?? 0) + f.count });
    }
  }
  return { masked, findings: [...totals.values()] };
}

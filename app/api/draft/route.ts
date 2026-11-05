// PLAN 작업 18: POST /api/draft — 선택한 판단 후보로 공문 형식 회신 초안을 만든다.
// 사안과 초안은 저장하지 않고 기록(로그)에도 남기지 않는다(CLAUDE.md §5).
import { parsePicks } from "../../lib/candidates";
import { buildDraft, draftRequestSchema } from "../../lib/draft";

function errorReply(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorReply(400, "INVALID_JSON", "요청 형식이 올바르지 않습니다.");
  }

  const checked = draftRequestSchema.safeParse(body);
  if (!checked.success) {
    return errorReply(400, "VALIDATION_ERROR", checked.error.issues[0]?.message ?? "입력 내용을 확인해 주세요.");
  }
  const picks = parsePicks(checked.data.picks);
  if (!picks) return errorReply(400, "VALIDATION_ERROR", "근거로 쓸 수 없는 자료가 있습니다. 법령은 조문을 정해서 선택해 주세요.");

  try {
    const result = await buildDraft(checked.data, picks);
    if (!result.ok) return errorReply(result.code === "NO_GROUNDED_DRAFT" ? 422 : 502, result.code, result.message);
    return Response.json({ data: result.data });
  } catch {
    return errorReply(500, "DRAFT_FAILED", "회신 초안을 만드는 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.");
  }
}

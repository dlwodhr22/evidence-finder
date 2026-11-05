// PLAN 작업 17·18: POST /api/candidates — 사용자가 고른 자료만 근거로 판단 후보를 만든다.
// `candidates`(화면에 있던 후보)를 함께 보내면 "근거 없는 내용 신고"로 보고 문장마다 원문과 다시 대조한다.
// 사안과 후보는 저장하지 않고 기록(로그)에도 남기지 않는다(CLAUDE.md §5).
import { buildCandidates, candidatesRecheckSchema, candidatesRequestSchema, parsePicks, recheckCandidates } from "../../lib/candidates";

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

  const isRecheck = typeof body === "object" && body !== null && "candidates" in body;
  const recheck = isRecheck ? candidatesRecheckSchema.safeParse(body) : null;
  const checked = recheck ?? candidatesRequestSchema.safeParse(body);
  if (!checked.success) {
    return errorReply(400, "VALIDATION_ERROR", checked.error.issues[0]?.message ?? "입력 내용을 확인해 주세요.");
  }
  const picks = parsePicks(checked.data.picks);
  if (!picks) {
    return errorReply(400, "VALIDATION_ERROR", "근거로 쓸 수 없는 자료가 있습니다. 법령은 조문을 정해서 선택해 주세요.");
  }

  try {
    const result =
      recheck && recheck.success
        ? await recheckCandidates(recheck.data.input, picks, recheck.data.candidates)
        : await buildCandidates(checked.data.input, picks);
    if (!result.ok) return errorReply(502, result.code, result.message);
    return Response.json({ data: result.data, regenerated: "regenerated" in result && result.regenerated === true });
  } catch {
    return errorReply(500, "CANDIDATES_FAILED", "판단 후보를 만드는 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.");
  }
}

// PLAN 작업 10: POST /api/search — 사안을 받아 법제처에서 근거를 찾아 돌려준다.
// Design Ref: §5 서버 기능 — 오류 응답은 { error: { code, message } } 한 가지 모양으로 통일한다.
// Design Ref: §10 보안 — 입력은 규칙(Zod)으로 검사한다. 사안 내용은 저장하지 않고 기록(로그)에도 남기지 않는다.
import { validateCaseInput } from "../../lib/case-input";
import { searchEvidence } from "../../lib/search";

function errorReply(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorReply(400, "INVALID_JSON", "요청 형식이 올바르지 않습니다.");
  }

  const checked = validateCaseInput(body);
  if (!checked.ok) {
    return errorReply(400, "VALIDATION_ERROR", "입력 내용을 확인해 주세요.", { fieldErrors: checked.errors });
  }

  try {
    const data = await searchEvidence(checked.data);
    return Response.json({ data });
  } catch (err) {
    // 오류 내용(message)에는 사안이나 키가 섞일 수 있으므로 내보내지도, 기록하지도 않는다.
    // 개발 중에만 원인을 찾을 수 있게 오류 종류와 코드 위치(파일:줄)만 기록한다.
    if (process.env.NODE_ENV !== "production" && err instanceof Error) {
      const where = (err.stack ?? "").split("\n").slice(1, 4).map((l) => l.trim().replace(/\(.*[\\/](app[\\/][^)]*)\)/, "($1)"));
      console.error(`[search] 실패: ${err.name}`, where.join(" | "));
    }
    return errorReply(500, "SEARCH_FAILED", "근거를 찾는 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.");
  }
}

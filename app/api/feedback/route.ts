// PLAN 작업 16: POST /api/feedback — 잘못된 결과 신고를 받아 법제처 원문과 다시 대조한 결과를 돌려준다.
// 신고 내용(이유·항목)은 저장하지 않고 기록(로그)에도 남기지 않는다(CLAUDE.md §5).
import { feedbackRequestSchema, reviewReport } from "../../lib/feedback";

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

  const checked = feedbackRequestSchema.safeParse(body);
  if (!checked.success) return errorReply(400, "VALIDATION_ERROR", "신고 내용을 확인해 주세요.");

  try {
    return Response.json({ data: await reviewReport(checked.data) });
  } catch {
    return errorReply(500, "FEEDBACK_FAILED", "다시 대조하는 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.");
  }
}

// Vercel에서 함수 실행 시간 한도(초). AI·법제처 호출이 기본 한도(10초)보다 오래 걸릴 수 있어 늘려 둔다.
export const maxDuration = 60;

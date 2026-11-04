// PLAN 작업 11·12: POST /api/clues — 웹에서 사례 단서를 찾고, 법제처에서 다시 확인해 돌려준다.
//
// 웹검색은 1분 가까이 걸릴 수 있어(2026-11-04 시험: 약 56초) /api/search와 따로 둔다.
// 화면은 법제처 직접 검색(/api/search) 결과를 먼저 보여주고, 이 결과가 오면 뒤이어 합친다.
// 웹 문장은 돌려주지 않는다. 돌려주는 것은 ① 법제처에서 확인된 자료 ② 검증 실패 단서(번호·날짜와 이유)
// ③ "참고, 검증 안 됨" 질의회신의 제목·링크뿐이다(PRD 5번 A).
import { maskCaseInput, validateCaseInput } from "../../lib/case-input";
import { verifyClues } from "../../lib/verify";
import { findWebClues } from "../../lib/web-clues";

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
    // 서버에서 개인정보를 한 번 더 가린 뒤 웹검색에 쓴다.
    const { masked } = maskCaseInput(checked.data);
    const web = await findWebClues(masked, []);
    const { verified, failed } = await verifyClues(web.clues);
    return Response.json({
      data: {
        verified,
        failed,
        references: web.references,
        notices: web.notice ? [web.notice] : [],
      },
    });
  } catch (err) {
    // 오류 내용(message)은 사안이나 키가 섞일 수 있어 내보내지도 기록하지도 않는다. 개발 중에만 종류와 위치를 남긴다.
    if (process.env.NODE_ENV !== "production" && err instanceof Error) {
      const where = (err.stack ?? "").split("\n").slice(1, 4).map((l) => l.trim().replace(/\(.*[\\/](app[\\/][^)]*)\)/, "($1)"));
      console.error(`[clues] 실패: ${err.name}`, where.join(" | "));
    }
    return errorReply(500, "CLUES_FAILED", "웹 사례 단서를 확인하는 중 문제가 생겼습니다.");
  }
}

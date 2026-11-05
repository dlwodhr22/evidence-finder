// PLAN 작업 14: GET /api/document — 선택한 항목의 법제처 원문, 그리고 원문 구절로 확인된 AI 요약.
// 주소 예: /api/document?kind=case&source=prec&id=123          → 원문
//         /api/document?kind=case&source=prec&id=123&summary=1 → 요약(원문을 다시 가져와 대조)
// 원문을 가져오지 못하면 요약하지 않고 오류를 알린다(CLAUDE.md §4-7).
import { connection } from "next/server";
import { loadDocument, parseDocumentRef, summarizeDocument } from "../../lib/document";

function errorReply(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function GET(request: Request): Promise<Response> {
  await connection(); // 요청마다 새로 처리(캐시하지 않음)
  const q = new URL(request.url).searchParams;
  const ref = parseDocumentRef({ kind: q.get("kind"), source: q.get("source"), id: q.get("id"), article: q.get("article") });
  if (!ref) return errorReply(400, "VALIDATION_ERROR", "불러올 자료를 알 수 없습니다.");

  const loaded = await loadDocument(ref);
  if (!loaded.ok) {
    return errorReply(502, "DOCUMENT_UNAVAILABLE", "법제처에서 원문을 가져오지 못했습니다. 잠시 뒤 다시 시도하거나 법제처 링크로 직접 확인해 주세요.");
  }

  if (q.get("summary") !== "1") return Response.json({ data: loaded.data.view });

  const summary = await summarizeDocument(loaded.data.fullText);
  if (!summary.ok) return errorReply(502, "SUMMARY_UNAVAILABLE", summary.error.message);
  return Response.json({ data: summary.data });
}

// Vercel에서 함수 실행 시간 한도(초). AI·법제처 호출이 기본 한도(10초)보다 오래 걸릴 수 있어 늘려 둔다.
export const maxDuration = 60;

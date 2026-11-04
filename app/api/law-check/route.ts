// PLAN 작업 1: 법제처 Open API 인증키(OC)가 승인되었는지, 호출 IP가 등록되었는지 확인하는 점검용 주소.
// Design Ref: §10 보안 — 키는 서버 코드에서만 읽고, 응답·로그에 키 값을 절대 넣지 않는다.
// Design Ref: §9 오류 처리 — 법제처는 오류도 HTTP 200으로 보내므로 응답 본문까지 확인한다.
import { connection } from "next/server";

// 법제처 법령 검색 주소. 점검에는 대표 업무 법령인 "국유재산법"으로 한 번만 검색해 본다.
const LAW_SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const SAMPLE_QUERY = "국유재산법";
const TIMEOUT_MS = 10_000;

type CheckStatus =
  | "ok" // 정상: 법제처가 검색 결과를 돌려줌
  | "missing-key" // .env에 LAW_API_OC가 없음
  | "verify-failed" // 법제처가 "사용자 정보 검증 실패"라고 답함
  | "network-error" // 법제처에 접속하지 못함(시간 초과 포함)
  | "unexpected"; // 예상하지 못한 모양의 응답

interface CheckResult {
  status: CheckStatus;
  message: string; // 사용자에게 보여줄 한 줄 설명
  nextSteps?: string[]; // 해결 방법
  lawApiMessage?: string; // 법제처가 보낸 안내 문구(키 값은 들어 있지 않음)
  sampleResultCount?: number; // 정상일 때 "국유재산법" 검색 결과 수
}

// 사람이 브라우저에서 읽기 쉽도록 들여쓰기한 JSON으로 돌려준다.
function reply(result: CheckResult, httpStatus: number): Response {
  return new Response(JSON.stringify(result, null, 2), {
    status: httpStatus,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// 응답이 { key: ... } 모양의 객체인지 확인한다.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function GET(): Promise<Response> {
  // 점검 결과가 빌드 때 한 번 고정되지 않고, 열 때마다 새로 확인되게 한다.
  await connection();

  // 점검용 주소는 개발 중에만 연다. 배포된 앱에서는 없는 주소처럼 동작한다.
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const oc = process.env.LAW_API_OC?.trim();
  if (!oc) {
    return reply(
      {
        status: "missing-key",
        message: ".env 파일에 LAW_API_OC 값이 없습니다.",
        nextSteps: [
          "open.law.go.kr 에서 회원가입 후 OPEN API 신청을 합니다.",
          ".env 파일에 LAW_API_OC=가입한 이메일의 @ 앞부분 을 한 줄 추가합니다.",
          "개발 서버를 껐다가 다시 켠 뒤(npm run dev) 이 주소를 새로고침합니다.",
        ],
      },
      500,
    );
  }

  const url = new URL(LAW_SEARCH_URL);
  url.searchParams.set("OC", oc);
  url.searchParams.set("target", "law");
  url.searchParams.set("type", "JSON");
  url.searchParams.set("query", SAMPLE_QUERY);

  let bodyText: string;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    bodyText = await res.text();
  } catch {
    // 오류 내용에는 요청 주소(키 포함)가 섞일 수 있으므로 그대로 보여주지 않는다.
    return reply(
      {
        status: "network-error",
        message: "법제처 서버에 접속하지 못했습니다.",
        nextSteps: [
          "인터넷 연결을 확인합니다.",
          "잠시 뒤 이 주소를 새로고침합니다.",
        ],
      },
      504,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return reply(
      {
        status: "unexpected",
        message: "법제처가 예상하지 못한 형식으로 답했습니다.",
        nextSteps: ["잠시 뒤 다시 시도하고, 계속되면 알려 주세요."],
      },
      502,
    );
  }

  // 실패 응답 예: { "result": "사용자 정보 검증에 실패하였습니다.", "msg": "...IP주소 및 도메인주소를 등록해 주세요." }
  if (isRecord(body) && typeof body.result === "string" && body.result.includes("검증")) {
    return reply(
      {
        status: "verify-failed",
        message: "법제처가 인증키를 확인하지 못했습니다.",
        lawApiMessage: typeof body.msg === "string" ? body.msg : body.result,
        nextSteps: [
          "OPEN API 신청이 아직 승인 전인지 open.law.go.kr 에서 확인합니다.",
          "LAW_API_OC 값이 가입한 이메일의 @ 앞부분과 정확히 같은지 확인합니다.",
          "open.law.go.kr 의 OPEN API 관리 화면에 지금 컴퓨터의 IP 주소가 등록되어 있는지 확인합니다.",
        ],
      },
      502,
    );
  }

  // 정상 응답 예: { "LawSearch": { "totalCnt": "3", "law": [...] } }
  if (isRecord(body) && isRecord(body.LawSearch)) {
    const count = Number(body.LawSearch.totalCnt);
    return reply(
      {
        status: "ok",
        message: "법제처 인증키가 정상입니다. 법령 검색이 됩니다.",
        sampleResultCount: Number.isFinite(count) ? count : undefined,
      },
      200,
    );
  }

  return reply(
    {
      status: "unexpected",
      message: "법제처 응답에서 검색 결과를 찾지 못했습니다.",
      nextSteps: ["잠시 뒤 다시 시도하고, 계속되면 알려 주세요."],
    },
    502,
  );
}

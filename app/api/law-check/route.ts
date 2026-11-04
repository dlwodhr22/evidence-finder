// PLAN 작업 1: 법제처 Open API 인증키(OC)가 승인되었는지, 호출 IP가 등록되었는지 확인하는 점검용 주소.
// PLAN 작업 3: 법제처 호출은 공통 도구(app/lib/law-api.ts)를 통해서만 한다.
// Design Ref: §10 보안 — 응답·로그에 키 값을 절대 넣지 않는다(공통 도구가 키를 지운다).
import { connection } from "next/server";
import { searchLaw, type LawApiErrorCode } from "../../lib/law-api";

// 점검에는 대표 업무 법령인 "국유재산법"으로 한 번만 검색해 본다.
const SAMPLE_QUERY = "국유재산법";

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

// 공통 도구의 오류 종류를 점검 화면의 안내로 바꾼다.
const GUIDES: Record<LawApiErrorCode, { status: CheckStatus; httpStatus: number; message: string; nextSteps: string[] }> = {
  MISSING_KEY: {
    status: "missing-key",
    httpStatus: 500,
    message: ".env 파일에 LAW_API_OC 값이 없습니다.",
    nextSteps: [
      "open.law.go.kr 에서 회원가입 후 OPEN API 신청을 합니다.",
      ".env 파일에 LAW_API_OC=가입한 이메일의 @ 앞부분 을 한 줄 추가합니다.",
      "개발 서버를 껐다가 다시 켠 뒤(npm run dev) 이 주소를 새로고침합니다.",
    ],
  },
  VERIFY_FAILED: {
    status: "verify-failed",
    httpStatus: 502,
    message: "법제처가 인증키를 확인하지 못했습니다.",
    nextSteps: [
      "OPEN API 신청이 아직 승인 전인지 open.law.go.kr 에서 확인합니다.",
      "LAW_API_OC 값이 가입한 이메일의 @ 앞부분과 정확히 같은지 확인합니다.",
      "open.law.go.kr 의 OPEN API 관리 화면에 지금 컴퓨터의 IP 주소가 등록되어 있는지 확인합니다.",
    ],
  },
  TIMEOUT: {
    status: "network-error",
    httpStatus: 504,
    message: "법제처 응답이 너무 늦습니다.",
    nextSteps: ["잠시 뒤 이 주소를 새로고침합니다."],
  },
  NETWORK: {
    status: "network-error",
    httpStatus: 504,
    message: "법제처 서버에 접속하지 못했습니다.",
    nextSteps: ["인터넷 연결을 확인합니다.", "잠시 뒤 이 주소를 새로고침합니다."],
  },
  HTTP_ERROR: {
    status: "unexpected",
    httpStatus: 502,
    message: "법제처 서버가 오류로 답했습니다.",
    nextSteps: ["잠시 뒤 다시 시도하고, 계속되면 알려 주세요."],
  },
  BAD_RESPONSE: {
    status: "unexpected",
    httpStatus: 502,
    message: "법제처가 예상하지 못한 형식으로 답했습니다.",
    nextSteps: ["잠시 뒤 다시 시도하고, 계속되면 알려 주세요."],
  },
};

// 사람이 브라우저에서 읽기 쉽도록 들여쓰기한 JSON으로 돌려준다.
function reply(result: CheckResult, httpStatus: number): Response {
  return new Response(JSON.stringify(result, null, 2), {
    status: httpStatus,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(): Promise<Response> {
  // 점검 결과가 빌드 때 한 번 고정되지 않고, 열 때마다 새로 확인되게 한다.
  await connection();

  // 점검용 주소는 개발 중에만 연다. 배포된 앱에서는 없는 주소처럼 동작한다.
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const result = await searchLaw("law", SAMPLE_QUERY, { display: 1 });

  if (!result.ok) {
    const guide = GUIDES[result.error.code];
    return reply(
      {
        status: guide.status,
        message: guide.message,
        nextSteps: guide.nextSteps,
        ...(result.error.lawApiMessage ? { lawApiMessage: result.error.lawApiMessage } : {}),
      },
      guide.httpStatus,
    );
  }

  return reply(
    {
      status: "ok",
      message: "법제처 인증키가 정상입니다. 법령 검색이 됩니다.",
      sampleResultCount: result.data.totalCount,
    },
    200,
  );
}

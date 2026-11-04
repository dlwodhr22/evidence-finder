// PLAN 작업 3: 법제처 Open API 호출 공통 도구.
// 법령·판례·해석례·행정심판례·자치법규 조회(작업 6~8번)는 모두 이 파일을 통해서만 법제처를 부른다.
//
// Design Ref: §10 보안 — 인증키(LAW_API_OC)는 서버에서만 읽고, 돌려주는 결과에서 키를 모두 지운다.
// Design Ref: §9 오류 처리 — 법제처는 오류도 HTTP 200으로 보내므로 응답 본문까지 확인한다.
// Design Ref: §5 — 오류는 { code, message } 한 가지 모양으로 통일한다.
//
// 이 파일은 서버 전용이다. 화면 조각(components)에서 직접 불러 쓰지 않는다.

const LAW_API_BASE = "https://www.law.go.kr/DRF/";
const LAW_PUBLIC_BASE = "https://www.law.go.kr/";
const TIMEOUT_MS = 10_000;

/** 법제처에서 조회할 수 있는 자료 종류 */
export type LawTarget = "law" | "prec" | "detc" | "expc" | "decc" | "ordin";

interface TargetInfo {
  label: string; // 화면에 쓸 이름
  rootKey: string; // 검색 응답의 맨 바깥 이름표
  listKey: string; // 검색 결과 목록이 들어 있는 이름표
  serialField: string; // 자료의 고유번호(일련번호)가 들어 있는 칸
  publicPath: string; // 누구나 열 수 있는 법제처 공개 화면 주소
  publicParam: string; // 공개 화면 주소에 고유번호를 넣는 이름
}

// 2026-11-04에 실제 응답과 공개 화면 주소를 확인해서 정한 값이다.
const TARGETS: Record<LawTarget, TargetInfo> = {
  law: {
    label: "법령",
    rootKey: "LawSearch",
    listKey: "law",
    serialField: "법령일련번호",
    publicPath: "lsInfoP.do",
    publicParam: "lsiSeq",
  },
  prec: {
    label: "판례",
    rootKey: "PrecSearch",
    listKey: "prec",
    serialField: "판례일련번호",
    publicPath: "precInfoP.do",
    publicParam: "precSeq",
  },
  detc: {
    label: "헌법재판소 결정",
    rootKey: "DetcSearch",
    listKey: "Detc",
    serialField: "헌재결정례일련번호",
    publicPath: "detcInfoP.do",
    publicParam: "detcSeq",
  },
  expc: {
    label: "법령해석례",
    rootKey: "Expc",
    listKey: "expc",
    serialField: "법령해석례일련번호",
    publicPath: "expcInfoP.do",
    publicParam: "expcSeq",
  },
  decc: {
    label: "행정심판례",
    rootKey: "Decc",
    listKey: "decc",
    serialField: "행정심판재결례일련번호",
    publicPath: "deccInfoP.do",
    publicParam: "deccSeq",
  },
  ordin: {
    label: "자치법규",
    rootKey: "OrdinSearch",
    listKey: "law", // 자치법규도 목록 이름표가 "law"로 온다
    serialField: "자치법규일련번호",
    publicPath: "ordinInfoP.do",
    publicParam: "ordinSeq",
  },
};

/** 오류 종류 */
export type LawApiErrorCode =
  | "MISSING_KEY" // .env에 LAW_API_OC가 없음
  | "VERIFY_FAILED" // 법제처가 "사용자 정보 검증 실패"라고 답함(승인 전·아이디 오류·IP 미등록)
  | "TIMEOUT" // 정해진 시간 안에 답이 없음
  | "NETWORK" // 법제처에 접속하지 못함
  | "HTTP_ERROR" // 법제처가 200이 아닌 상태로 답함
  | "BAD_RESPONSE"; // 예상한 모양이 아닌 응답

export interface LawApiError {
  code: LawApiErrorCode;
  message: string; // 사용자에게 보여줄 한국어 설명
  lawApiMessage?: string; // 법제처가 보낸 안내 문구(키 값은 지운 상태)
}

/** 모든 법제처 호출은 성공 또는 실패 중 하나의 모양으로 돌아온다 */
export type LawApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LawApiError };

/** 검색 결과 한 쪽(page) */
export interface LawSearchPage {
  target: LawTarget;
  totalCount: number; // 전체 검색 결과 수
  items: LawRawItem[]; // 이번에 받은 항목들(키는 지운 상태)
}

/** 법제처가 준 항목 한 건. 칸 이름은 자료 종류마다 다르다(예: "사건번호", "법령명한글"). */
export type LawRawItem = Record<string, string>;

const MESSAGES: Record<LawApiErrorCode, string> = {
  MISSING_KEY: "법제처 인증키(LAW_API_OC)가 설정되지 않았습니다.",
  VERIFY_FAILED: "법제처가 인증키를 확인하지 못했습니다.",
  TIMEOUT: "법제처 응답이 너무 늦어 중단했습니다. 잠시 뒤 다시 시도해 주세요.",
  NETWORK: "법제처 서버에 접속하지 못했습니다.",
  HTTP_ERROR: "법제처 서버가 오류로 답했습니다. 잠시 뒤 다시 시도해 주세요.",
  BAD_RESPONSE: "법제처가 예상하지 못한 형식으로 답했습니다.",
};

function fail(code: LawApiErrorCode, lawApiMessage?: string): { ok: false; error: LawApiError } {
  return {
    ok: false,
    error: lawApiMessage
      ? { code, message: MESSAGES[code], lawApiMessage }
      : { code, message: MESSAGES[code] },
  };
}

/** 다른 도구(laws.ts 등)에서 같은 모양의 실패를 만들 때 쓴다 */
export const lawApiFailure = fail;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 결과가 1건이면 목록이 아니라 낱개로 오고, 0건이면 아예 없다. 항상 목록으로 바꿔 준다. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** 글 속의 "OC=인증키" 부분을 지운다. 법제처 상세 링크에는 인증키가 그대로 들어 있다. */
function stripKeyFromText(text: string): string {
  return text
    .replace(/([?&])OC=[^&#]*&?/g, "$1")
    .replace(/[?&](#|$)/, "$1");
}

/** 응답 전체를 돌며 모든 글에서 인증키를 지운다. */
function stripKeyDeep(value: unknown): unknown {
  if (typeof value === "string") return stripKeyFromText(value);
  if (Array.isArray(value)) return value.map(stripKeyDeep);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stripKeyDeep(v)]),
    );
  }
  return value;
}

/**
 * 법제처를 한 번 부른다. 키 확인 → 호출 → 오류 확인 → 키 지우기까지 여기서 모두 처리한다.
 * @param endpoint "lawSearch.do"(검색) 또는 "lawService.do"(본문 조회)
 */
export async function callLawApi(
  endpoint: "lawSearch.do" | "lawService.do",
  params: Record<string, string | number>,
): Promise<LawApiResult<unknown>> {
  if (typeof window !== "undefined") {
    // 브라우저에서 불리면 키가 드러날 수 있으므로 막는다.
    throw new Error("law-api는 서버에서만 사용할 수 있습니다.");
  }

  const oc = process.env.LAW_API_OC?.trim();
  if (!oc) return fail("MISSING_KEY");

  const url = new URL(endpoint, LAW_API_BASE);
  url.searchParams.set("OC", oc);
  url.searchParams.set("type", "JSON");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    // 오류 내용에는 요청 주소(키 포함)가 섞일 수 있으므로 그대로 내보내지 않는다.
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return fail(isTimeout ? "TIMEOUT" : "NETWORK");
  }
  if (!res.ok) return fail("HTTP_ERROR");

  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return fail("BAD_RESPONSE");
  }

  // 실패 응답 예: { "result": "사용자 정보 검증에 실패하였습니다.", "msg": "...IP주소 및 도메인주소를 등록해 주세요." }
  if (isRecord(body) && typeof body.result === "string" && body.result.includes("검증")) {
    const msg = typeof body.msg === "string" ? body.msg : body.result;
    return fail("VERIFY_FAILED", stripKeyFromText(msg));
  }

  const cleaned = stripKeyDeep(body);
  // 마지막 안전장치: 지우고도 키가 남아 있으면 결과를 내보내지 않는다.
  if (JSON.stringify(cleaned).includes(`OC=${oc}`)) return fail("BAD_RESPONSE");

  return { ok: true, data: cleaned };
}

/**
 * 자료를 검색해 한 가지 모양(LawSearchPage)으로 돌려준다.
 * @param display 한 번에 받을 항목 수(법제처 기본 20)
 */
export async function searchLaw(
  target: LawTarget,
  query: string,
  {
    page = 1,
    display = 20,
    search,
  }: { page?: number; display?: number; search?: number } = {},
): Promise<LawApiResult<LawSearchPage>> {
  const info = TARGETS[target];
  // search: 법제처 검색 방식(1 = 이름, 2 = 본문). 없으면 법제처 기본값(이름)을 쓴다.
  const result = await callLawApi("lawSearch.do", {
    target,
    query,
    page,
    display,
    ...(search !== undefined ? { search } : {}),
  });
  if (!result.ok) return result;

  const root = isRecord(result.data) ? result.data[info.rootKey] : undefined;
  if (!isRecord(root)) return fail("BAD_RESPONSE");

  const totalCount = Number(root.totalCnt);
  const items = asArray(root[info.listKey])
    .filter(isRecord)
    .map((item) =>
      Object.fromEntries(
        Object.entries(item).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]),
      ),
    );

  return {
    ok: true,
    data: { target, totalCount: Number.isFinite(totalCount) ? totalCount : items.length, items },
  };
}

/** 항목의 고유번호(일련번호). 원문 조회와 공개 링크에 쓴다. */
export function serialOf(target: LawTarget, item: LawRawItem): string | undefined {
  const value = item[TARGETS[target].serialField]?.trim();
  return value ? value : undefined;
}

/** 인증키 없이 누구나 열 수 있는 법제처 공개 화면 주소 */
export function publicLink(target: LawTarget, serial: string): string {
  const info = TARGETS[target];
  const url = new URL(info.publicPath, LAW_PUBLIC_BASE);
  url.searchParams.set(info.publicParam, serial);
  return url.toString();
}

/** 화면에 쓸 자료 종류 이름(예: "판례") */
export function targetLabel(target: LawTarget): string {
  return TARGETS[target].label;
}

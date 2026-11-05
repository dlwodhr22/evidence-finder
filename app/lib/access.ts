// 접근 코드: 공개 주소로 올려도 코드를 아는 사람만 쓸 수 있게 막는다(OpenAI 비용·법제처 키 남용 방지).
// 보안 점검(2026-11-05) 1번 — 로그인 없이 누구나 API를 부를 수 있어 비용이 소진될 수 있다는 지적에 대한 대응.
//
// 동작 규칙
//  - 서버 환경 변수 APP_ACCESS_CODE가 있으면: 코드를 입력해 쿠키를 받은 사람만 화면과 API를 쓸 수 있다.
//  - 없으면: 개발 중(내 컴퓨터)에는 그냥 열어 두고, 운영(배포)에서는 안전을 위해 모두 막는다(코드를 안 넣고 공개하는 실수 방지).
// 회원 관리가 아니다. 사람마다 계정이 있지 않고, 하나의 공유 코드만 쓴다.
//
// 이 파일은 서버 전용이다(proxy.ts와 /access 경로에서만 쓴다).

export const ACCESS_COOKIE = "app_access";
export const ACCESS_MAX_AGE_SECONDS = 12 * 60 * 60; // 12시간 뒤 다시 코드를 입력한다

export type GateMode =
  | "protected" // 코드가 설정되어 있음 → 코드를 입력해야 함
  | "open" // 코드가 없고 개발 중 → 그냥 열어 둠
  | "misconfigured"; // 코드가 없는데 운영 환경 → 안전을 위해 모두 막음

export function gateMode(env: Record<string, string | undefined> = process.env): GateMode {
  if (env.APP_ACCESS_CODE?.trim()) return "protected";
  return env.NODE_ENV === "production" ? "misconfigured" : "open";
}

/** 쿠키에 넣는 값: 코드 자체가 아니라 코드를 섞어 만든 지문(SHA-256)이다 */
export async function tokenFor(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`access:v1:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 길이가 같은 두 글을 같은 시간에 비교한다(걸린 시간으로 글자를 짐작하지 못하게) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 입력한 코드가 맞는지 */
export async function checkCode(input: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const code = env.APP_ACCESS_CODE?.trim();
  if (!code) return false;
  return safeEqual(await tokenFor(input.trim()), await tokenFor(code));
}

/** 쿠키 값이 지금 설정된 코드에서 나온 것인지 */
export async function isAuthorized(cookieValue: string | undefined, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const code = env.APP_ACCESS_CODE?.trim();
  if (!code || !cookieValue) return false;
  return safeEqual(cookieValue, await tokenFor(code));
}

// 접근 코드 입력창(GET)과 코드 확인(POST). 화면 틀 없이 간단한 HTML만 돌려준다.
// 입력한 글은 화면에 다시 보여주지 않는다(스크립트 끼어듦 방지).
import { connection, NextResponse } from "next/server";
import { ACCESS_COOKIE, ACCESS_MAX_AGE_SECONDS, checkCode, gateMode, isAuthorized, tokenFor } from "../lib/access";

function page(message: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>접근 코드 입력</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,"Noto Sans KR",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem}
main{width:min(24rem,100%)}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{margin:.25rem 0 1rem;font-size:.9rem;opacity:.8}
input,button{font:inherit;padding:.6rem .75rem;border-radius:.5rem;border:1px solid #8888;width:100%;box-sizing:border-box}
button{margin-top:.75rem;cursor:pointer;font-weight:600}
.err{color:#b91c1c;opacity:1;font-weight:600}
</style></head><body><main>
<h1>근거 찾기 도우미</h1>
<p>이 서비스는 접근 코드를 아는 분만 사용할 수 있습니다.</p>
${message ? `<p class="err" role="alert">${message}</p>` : ""}
<form method="post" action="/access">
<label for="code">접근 코드</label>
<input id="code" name="code" type="password" autocomplete="off" autofocus required maxlength="200">
<button type="submit">들어가기</button>
</form></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  const mode = gateMode();
  if (mode === "open") return NextResponse.redirect(new URL("/", request.url));
  if (mode === "misconfigured") return page("접근 코드(APP_ACCESS_CODE)가 설정되지 않아 사용할 수 없습니다.", 503);
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${ACCESS_COOKIE}=`))?.slice(ACCESS_COOKIE.length + 1);
  if (await isAuthorized(cookie)) return NextResponse.redirect(new URL("/", request.url));
  const wrong = new URL(request.url).searchParams.get("error") === "1";
  return page(wrong ? "접근 코드가 맞지 않습니다. 다시 입력해 주세요." : "");
}

export async function POST(request: Request): Promise<Response> {
  await connection();
  const mode = gateMode();
  if (mode === "misconfigured") return page("접근 코드(APP_ACCESS_CODE)가 설정되지 않아 사용할 수 없습니다.", 503);
  if (mode === "open") return NextResponse.redirect(new URL("/", request.url), 303);

  let input = "";
  try {
    const form = await request.formData();
    const value = form.get("code");
    input = typeof value === "string" ? value.slice(0, 200) : "";
  } catch {
    input = "";
  }

  if (!(await checkCode(input))) {
    // 틀린 코드를 빠르게 계속 넣어 보는 것을 늦춘다
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return NextResponse.redirect(new URL("/access?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(ACCESS_COOKIE, await tokenFor(process.env.APP_ACCESS_CODE!.trim()), {
    httpOnly: true, // 화면의 스크립트가 읽지 못한다
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });
  return response;
}

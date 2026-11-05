// 모든 요청이 화면·API에 닿기 전에 접근 코드를 확인한다(app/lib/access.ts 참고).
// 코드를 입력해 쿠키를 받은 사람만 지나갈 수 있고, 아니면 화면은 입력창(/access)으로, API는 401로 돌려보낸다.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, gateMode, isAuthorized } from "./app/lib/access";

export async function proxy(request: NextRequest) {
  const mode = gateMode();
  if (mode === "open") return NextResponse.next(); // 개발 중이고 코드가 없으면 열어 둔다

  const path = request.nextUrl.pathname;
  if (path === "/access") return NextResponse.next(); // 입력창과 코드 확인은 항상 지나간다

  if (mode === "misconfigured") {
    // 운영인데 코드가 설정되지 않음 → 모두 막는다(실수로 공개되는 것 방지)
    return new NextResponse("접근 코드(APP_ACCESS_CODE)가 설정되지 않아 사용할 수 없습니다.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (await isAuthorized(request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "접근 코드를 먼저 입력해 주세요." } }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/access", request.url));
}

// 정적 파일(_next/static, 이미지 최적화, 아이콘)은 제외한다
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

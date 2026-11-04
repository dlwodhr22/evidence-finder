// PLAN 작업 2: 앱의 공통 틀(제목, 머리말, 본문 영역, 안내 문구).
// Design Ref: §3.1 화면 구성 — 머리말에 앱 이름과 "참고 자료 확인 도우미"를 보여준다.
import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 한글이 잘 보이는 글꼴. 굵기 3가지만 불러와 화면을 가볍게 유지한다.
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

// 앱 이름. 바꾸고 싶으면 이 한 줄만 고치면 된다.
const APP_NAME = "근거 찾기 도우미";

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "대민업무 회신을 위해 법제처에서 확인된 법령·판례·해석례만 찾아 보여주는 참고 자료 확인 도우미",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* 머리말: 모든 화면 맨 위에 공통으로 보인다 */}
        <header className="border-b border-black/10 dark:border-white/15">
          <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
            <p className="text-xl font-bold">{APP_NAME}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              참고 자료 확인 도우미 · 법제처에서 확인된 자료만 보여줍니다
            </p>
          </div>
        </header>

        {/* 본문: 각 화면의 내용이 들어가는 자리 */}
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>

        {/* 꼬리말: PRD 원칙(결론 확정 금지, 최종 판단은 사람)을 늘 보이게 한다 */}
        <footer className="border-t border-black/10 dark:border-white/15">
          <p className="mx-auto w-full max-w-3xl px-4 py-4 text-xs text-zinc-600 sm:px-6 dark:text-zinc-400">
            이 앱이 보여주는 판단 후보와 회신 초안은 참고용입니다. 최종 판단과 회신은
            담당자가 원문을 확인한 뒤 직접 합니다.
          </p>
        </footer>
      </body>
    </html>
  );
}

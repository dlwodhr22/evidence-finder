// PLAN 작업 2: 메인 화면의 기본 틀.
// Design Ref: §3.1 — 한 페이지에서 ① 입력 → ② 목록 → ③ 원문 → ④ 판단 후보·초안 순서로 진행한다.
// ① 사안 입력(작업 9), ② 확인된 자료 목록(작업 13), ③ 원문 확인(작업 14), ④ 판단 후보(작업 17)는 Workspace가 함께 그린다.
// 회신 초안(작업 18번)은 ④ 칸에 이어서 붙인다.

import Workspace from "./components/Workspace";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-bold">사안을 입력하면 근거를 찾아 드립니다</h1>
        <p className="mt-2 text-zinc-700 dark:text-zinc-300">
          아래 순서대로 진행합니다. 화면에 나오는 모든 자료에는 출처와 법제처 원문
          링크가 붙습니다.
        </p>
      </section>

      <ol className="flex flex-col gap-4">
        <Workspace />
      </ol>
    </div>
  );
}

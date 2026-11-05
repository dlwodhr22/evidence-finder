// PLAN 작업 2: 메인 화면의 기본 틀. 실제 기능은 뒤의 작업에서 각 칸에 채운다.
// Design Ref: §3.1 — 한 페이지에서 ① 입력 → ② 목록 → ③ 원문 → ④ 판단 후보·초안 순서로 진행한다.
// ① 사안 입력(작업 9), ② 확인된 자료 목록(작업 13), ③ 원문 확인(작업 14)은 Workspace가 함께 그린다.

import Workspace from "./components/Workspace";

// 아직 만들지 않은 단계와, 각 단계를 만드는 PLAN 작업 번호
const STEPS = [
  {
    no: "④",
    title: "판단 후보와 회신 초안",
    description: "고른 자료만 근거로 판단 후보와 공문 형식 회신 초안을 만듭니다.",
    planTask: 17,
  },
] as const;

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

        {STEPS.map((step) => (
          <li
            key={step.no}
            className="rounded-lg border border-black/10 p-4 dark:border-white/15"
          >
            <h2 className="text-lg font-semibold">
              {step.no} {step.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {step.description}
            </p>
            {/* 아직 만들지 않은 칸임을 분명히 표시한다 */}
            <p className="mt-3 text-xs text-zinc-500">
              준비 중 · PLAN 작업 {step.planTask}번에서 만듭니다
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

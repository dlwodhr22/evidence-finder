"use client";
// PLAN 작업 13: ① 사안 입력과 ② 확인된 자료 목록을 한곳에서 묶는다.
// 입력 양식이 찾은 결과를 목록이 받아 보여주고, 근거로 고른 자료(선택)를 여기서 기억한다
// (작업 17번 판단 후보에서 이 선택을 쓴다). 고른 자료는 저장하지 않고 이 화면에만 둔다.
import { useCallback, useState } from "react";
import CaseForm from "./CaseForm";
import type { EvidenceState } from "./evidence-types";
import ResultList from "./ResultList";

const CARD = "rounded-lg border border-black/10 p-4 dark:border-white/15";

export default function Workspace() {
  const [state, setState] = useState<EvidenceState>({ search: { status: "idle" }, clues: { status: "idle" } });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleStateChange = useCallback((next: EvidenceState) => {
    // 새로 찾는 중에는 이전에 고른 자료를 비운다(목록이 바뀌므로).
    if (next.search.status === "loading") setSelected(new Set());
    setState(next);
  }, []);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <>
      <li className={CARD}>
        <h2 className="text-lg font-semibold">① 사안 입력</h2>
        <p className="mt-1 mb-4 text-sm text-zinc-700 dark:text-zinc-300">
          사안 내용과 판단해야 할 쟁점을 적어 주세요. 법령·판례 이름을 몰라도 됩니다.
        </p>
        <CaseForm onStateChange={handleStateChange} />
      </li>

      <li className={CARD}>
        <h2 className="text-lg font-semibold">② 확인된 자료 목록</h2>
        <p className="mt-1 mb-4 text-sm text-zinc-700 dark:text-zinc-300">
          법제처에서 확인된 법령·판례·해석례·행정심판례만 보여줍니다. 판단 근거로 쓸 자료에 체크해 두세요.
        </p>
        <ResultList state={state} selected={selected} onToggle={toggle} />
      </li>
    </>
  );
}

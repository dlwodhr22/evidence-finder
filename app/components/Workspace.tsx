"use client";
// PLAN 작업 13: ① 사안 입력과 ② 확인된 자료 목록을 한곳에서 묶는다.
// 입력 양식이 찾은 결과를 목록이 받아 보여주고, 근거로 고른 자료(선택)를 여기서 기억한다
// ④ 판단 후보(작업 17번)에서 이 선택을 쓴다. 고른 자료는 저장하지 않고 이 화면에만 둔다.
import { useCallback, useState } from "react";
import { resultKey } from "../lib/results";
import type { VerifiedItem } from "../lib/types";
import CandidatePanel from "./CandidatePanel";
import CaseForm from "./CaseForm";
import DocumentViewer from "./DocumentViewer";
import type { EvidenceState } from "./evidence-types";
import type { FeedbackResult } from "../lib/feedback";
import ResultList, { type Override } from "./ResultList";

const CARD = "rounded-lg border border-black/10 p-4 dark:border-white/15";

export default function Workspace() {
  const [state, setState] = useState<EvidenceState>({ search: { status: "idle" }, clues: { status: "idle" } });
  const [selected, setSelected] = useState<Map<string, VerifiedItem>>(new Map());
  const [opened, setOpened] = useState<VerifiedItem | null>(null); // ③에서 보고 있는 자료

  const [overrides, setOverrides] = useState<Record<string, Override>>({}); // 신고 후 다시 대조한 결과

  const handleStateChange = useCallback((next: EvidenceState) => {
    // 새로 찾는 중에는 이전에 고른 자료·열어 본 원문·신고 결과를 비운다(목록이 바뀌므로).
    if (next.search.status === "loading") {
      setSelected(new Map());
      setOpened(null);
      setOverrides({});
    }
    setState(next);
  }, []);

  // 신고 결과를 목록에 반영한다. 법제처에서 확인되지 않은 항목은 근거 선택과 원문 보기에서도 뺀다.
  const handleReport = useCallback((item: VerifiedItem, result: FeedbackResult) => {
    const key = resultKey(item);
    if (result.outcome === "removed") {
      setOverrides((prev) => ({ ...prev, [key]: { type: "removed", item } }));
      setSelected((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      // ③에서 보고 있던 자료는 닫지 않고, 신고 결과 창이 보이도록 둔다(화면에 "근거로 쓸 수 없음"을 표시한다).
    } else if (result.outcome === "corrected" && result.item) {
      const fixed = result.item;
      setOverrides((prev) => ({ ...prev, [key]: { type: "corrected", item: fixed } }));
      setOpened((cur) => (cur && resultKey(cur) === key ? fixed : cur));
    }
  }, []);

  const toggle = useCallback((item: VerifiedItem) => {
    const key = resultKey(item);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });
  }, []);

  // ④에서 근거로 쓸 자료: 신고 후 고쳐진 값이 있으면 그 값을 쓰고, 확인되지 않은 자료는 뺀다.
  const picks = [...selected.entries()].flatMap(([key, item]) => {
    const o = overrides[key];
    if (o?.type === "removed") return [];
    return [o?.item ?? item];
  });

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
        <ResultList state={state} selected={selected} onToggle={toggle}
          onOpen={setOpened}
          overrides={overrides}
          onReport={handleReport}
        />
      </li>

      <li className={CARD} id="document-view">
        <h2 className="text-lg font-semibold">③ 원문 확인</h2>
        {opened ? (
          <div className="mt-3">
            {/* 항목이 바뀌면 화면을 새로 시작하도록 key를 준다 */}
            <DocumentViewer
              key={resultKey(opened)}
              item={opened}
              removed={overrides[resultKey(opened)]?.type === "removed"}
              onClose={() => setOpened(null)}
              onReport={(result) => handleReport(opened, result)}
              pickedKeys={new Set(selected.keys())}
              onPick={toggle}
            />
          </div>
        ) : (
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            ② 목록에서 [원문 확인]을 누르면 법제처 원문과, 원문과 구분된 AI 요약이 여기에 나옵니다.
          </p>
        )}
      </li>

      <li className={CARD}>
        <h2 className="text-lg font-semibold">④ 판단 후보</h2>
        <p className="mt-1 mb-4 text-sm text-zinc-700 dark:text-zinc-300">
          고른 자료만 근거로 판단 후보를 보여줍니다. 결론이 아니라 검토할 방향이며, 최종 판단은 담당자가 합니다.
        </p>
        <CandidatePanel
          input={state.search.status === "done" ? state.search.data.maskedInput : null}
          picks={picks}
          onRemove={toggle}
        />
      </li>
    </>
  );
}

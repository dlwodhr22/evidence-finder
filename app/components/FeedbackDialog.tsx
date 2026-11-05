"use client";
// PLAN 작업 16: 잘못된 결과 신고 창. 이유를 고르면 그 항목을 법제처 원문과 다시 대조해 바로잡는다.
// Design Ref: §3.2 — 이유는 세 가지 중 선택(글 입력 칸 없음), "사안과 관련 없음"은 두지 않는다.
// PRD 5번 A — 신고 내용은 저장하지 않는다. 창을 닫으면 사라진다.
import { useRef, useState } from "react";
import type { FeedbackReason, FeedbackResult } from "../lib/feedback";
import type { VerifiedItem } from "../lib/types";

const REASON_LABELS: Record<FeedbackReason, string> = {
  wrong: "없는 자료이거나 사건번호·조문이 틀림",
  summary: "AI 요약·인용이 원문과 다름",
  outdated: "폐지·개정된 법령임",
};

interface FeedbackDialogProps {
  item: VerifiedItem;
  /** ③에서 보고 있는 조문(요약 신고에 쓴다) */
  article?: string;
  /** 요약이 화면에 있을 때만 "요약이 원문과 다름"을 고를 수 있다 */
  allowSummary?: boolean;
  /** 다시 대조한 결과를 화면에 반영한다 */
  onResult: (result: FeedbackResult) => void;
}

export default function FeedbackDialog({ item, article, allowSummary = false, onResult }: FeedbackDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<FeedbackReason>("wrong");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [error, setError] = useState("");

  const reasons: FeedbackReason[] = ["wrong", ...(allowSummary ? (["summary"] as const) : []), ...(item.kind === "law" ? (["outdated"] as const) : [])];

  function open() {
    setResult(null);
    setError("");
    setReason("wrong");
    dialogRef.current?.showModal();
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, item, ...(article ? { article } : {}) }),
      });
      const json: unknown = await res.json();
      if (res.ok && typeof json === "object" && json !== null && "data" in json) {
        const data = (json as { data: FeedbackResult }).data;
        setResult(data);
        onResult(data);
      } else {
        setError("다시 대조하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      }
    } catch {
      setError("네트워크 문제로 다시 대조하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded border border-red-400 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:border-red-500 dark:text-red-300"
      >
        잘못된 결과 신고
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-black/20 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-white/20 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <h3 id="feedback-title" className="font-semibold">
          잘못된 결과 신고
        </h3>
        <p className="mt-1 text-sm break-words text-zinc-700 dark:text-zinc-300">{item.title}</p>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          신고하면 이 자료를 법제처 원문과 다시 대조해 바로잡습니다. 신고 내용은 저장하지 않으며 창을 닫으면 사라집니다.
        </p>

        {!result && (
          <fieldset className="mt-3 flex flex-col gap-2" disabled={busy}>
            <legend className="mb-1 text-sm font-medium">무엇이 잘못되었나요?</legend>
            {reasons.map((r) => (
              <label key={r} className="flex items-start gap-2 text-sm">
                <input type="radio" name="feedback-reason" checked={reason === r} onChange={() => setReason(r)} className="mt-1" />
                {REASON_LABELS[r]}
              </label>
            ))}
          </fieldset>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {result && (
          <div role="status" className="mt-3 rounded-md bg-zinc-100 p-3 text-sm dark:bg-zinc-800">
            <p className="font-medium">{result.message}</p>
            {result.changes.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {result.changes.map((c) => (
                  <li key={c} className="break-words">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {!result && (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy ? "법제처와 다시 대조하는 중…" : "법제처 원문과 다시 대조하기"}
            </button>
          )}
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
          >
            닫기
          </button>
        </div>
      </dialog>
    </>
  );
}

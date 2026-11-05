"use client";
// PLAN 작업 17: ④ 판단 후보. 사용자가 고른 자료만 근거로 후보를 보여준다.
// CLAUDE.md §4-8 — 결론을 확정하지 않고 후보로만 제시한다. 후보마다 근거 출처를 붙이고, 엇갈리는 근거도 숨기지 않는다.
// 회신 초안(작업 18번)은 후보 아래에 이어서 붙는다(DraftPanel).
import { useState } from "react";
import type { CaseInput } from "../lib/case-input";
import type { CandidatePoint, CandidatesView } from "../lib/candidate-types";
import { MAX_PICKS } from "../lib/candidate-types";
import { refOf, type DocumentRef } from "../lib/document-types";
import type { DraftView } from "../lib/draft-types";
import DraftPanel from "./DraftPanel";
import { isLawGoKrUrl } from "../lib/links";
import type { VerifiedItem } from "../lib/types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; data: CandidatesView };

function Point({ p }: { p: CandidatePoint }) {
  return (
    <li className="text-sm">
      <p className="break-words">{p.text}</p>
      <p className="mt-0.5 text-xs break-words text-zinc-600 dark:text-zinc-400">
        근거 원문: “{p.quote}”
        <br />
        출처: {p.source.title} · {p.source.citation}
        {isLawGoKrUrl(p.source.sourceUrl) && (
          <>
            {" "}
            <a href={p.source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline dark:text-blue-300">
              법제처 원문 ↗
            </a>
          </>
        )}
      </p>
    </li>
  );
}

export default function CandidatePanel({
  input,
  picks,
  onRemove,
}: {
  input: CaseInput | null;
  picks: VerifiedItem[];
  onRemove: (item: VerifiedItem) => void;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  // 후보를 만들 때 쓴 자료. 자료 번호(s1…)가 이 순서에 묶여 있어서, 초안·다시 대조도 이 목록으로 보낸다.
  const [usedRefs, setUsedRefs] = useState<DocumentRef[]>([]);
  // 회신 초안: 어느 후보로 만들었는지와 상태
  const [draft, setDraft] = useState<{ index: number; status: "loading" } | { index: number; status: "error"; message: string } | { index: number; status: "done"; data: DraftView } | null>(null);

  async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T; regenerated: boolean } | { ok: false; message: string }> {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json: unknown = await res.json();
      if (res.ok && typeof json === "object" && json !== null && "data" in json) {
        return { ok: true, data: (json as { data: T }).data, regenerated: (json as { regenerated?: boolean }).regenerated === true };
      }
      const message =
        typeof json === "object" && json !== null && "error" in json ? String((json as { error: { message?: string } }).error.message ?? "") : "";
      return { ok: false, message: message || "처리하지 못했습니다." };
    } catch {
      return { ok: false, message: "네트워크 문제로 처리하지 못했습니다." };
    }
  }

  async function make() {
    if (!input || picks.length === 0) return;
    setState({ status: "loading" });
    setDraft(null);
    const refs = picks.map(refOf);
    const r = await post<CandidatesView>("/api/candidates", { input, picks: refs });
    if (r.ok) {
      setUsedRefs(refs);
      setState({ status: "done", data: r.data });
    } else {
      setState({ status: "error", message: r.message || "판단 후보를 만들지 못했습니다." });
    }
  }

  // 회신 초안 만들기: 고른 후보와 후보를 만들 때 쓴 자료로 만든다
  async function makeDraft(index: number) {
    if (state.status !== "done" || !input) return;
    const c = state.data.candidates[index];
    const candidate = {
      title: c.title,
      reasons: c.reasons.map((p) => ({ text: p.text, quote: p.quote, sourceId: p.source.id })),
      counterpoints: c.counterpoints.map((p) => ({ text: p.text, quote: p.quote, sourceId: p.source.id })),
    };
    setDraft({ index, status: "loading" });
    const r = await post<DraftView>("/api/draft", { input, picks: usedRefs, candidate });
    if (!r.ok) {
      setDraft({ index, status: "error", message: r.message });
      return;
    }
    setDraft({ index, status: "done", data: r.data });
  }

  if (!input) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">① 사안을 입력하고 근거를 찾은 뒤, 근거로 쓸 자료를 골라 주세요.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">근거로 선택한 자료 {picks.length}건</p>
        {picks.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            ②에서 체크하거나 ③에서 [근거로 선택]을 누르면 여기에 담깁니다. 고른 자료만 근거로 쓰고, 고르지 않은 자료는 쓰지 않습니다.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {picks.map((p) => (
              <li key={`${p.kind}-${p.id}-${p.kind === "law" ? (p.article ?? "") : ""}`} className="flex items-start justify-between gap-2">
                <span className="break-words">
                  {p.title}
                  {p.kind === "law" && p.article ? ` ${p.article}` : ""}
                </span>
                <button type="button" onClick={() => onRemove(p)} className="shrink-0 text-xs text-red-700 underline">
                  빼기
                </button>
              </li>
            ))}
          </ul>
        )}
        {picks.length > MAX_PICKS && (
          <p role="alert" className="mt-1 text-sm text-red-700">
            근거는 {MAX_PICKS}건까지 고를 수 있습니다. 일부를 빼 주세요.
          </p>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={make}
          disabled={picks.length === 0 || picks.length > MAX_PICKS || state.status === "loading"}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {state.status === "loading" ? "원문을 확인하며 후보를 만드는 중…" : "판단 후보 만들기"}
        </button>
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}

      {state.status === "done" && (
        <div className="flex flex-col gap-4">
          {state.data.excluded.map((e) => (
            <p key={e.title} className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {e.title}: {e.reason}
            </p>
          ))}

          {state.data.candidates.length === 0 ? (
            <p className="rounded-md border border-black/10 bg-zinc-50 p-3 text-sm font-medium dark:border-white/15 dark:bg-zinc-900">
              고른 자료의 원문으로 뒷받침되는 판단 후보를 만들지 못했습니다. 근거로 쓸 자료를 더 고르거나 바꿔 다시 시도해 주세요.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {state.data.candidates.map((c, i) => (
                <li key={i} className="rounded-md border border-black/15 p-3 dark:border-white/20">
                  <p className="text-xs font-semibold text-zinc-500">판단 후보 {i + 1} · 확정된 결론이 아닙니다</p>
                  <h3 className="mt-0.5 font-semibold break-words">{c.title}</h3>
                  <p className="mt-2 text-xs font-semibold">뒷받침하는 근거</p>
                  <ul className="mt-1 flex flex-col gap-2">
                    {c.reasons.map((p, j) => (
                      <Point key={j} p={p} />
                    ))}
                  </ul>
                  {c.counterpoints.length > 0 && (
                    <div className="mt-3 rounded-md bg-amber-50 p-2 dark:bg-amber-950">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">엇갈리는 근거 (함께 검토하세요)</p>
                      <ul className="mt-1 flex flex-col gap-2">
                        {c.counterpoints.map((p, j) => (
                          <Point key={j} p={p} />
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => makeDraft(i)}
                      disabled={draft?.index === i && draft.status === "loading"}
                      className="rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-700 disabled:opacity-50 dark:border-blue-400 dark:text-blue-300"
                    >
                      {draft?.index === i && draft.status === "loading" ? "회신 초안을 만드는 중…" : "이 후보로 회신 초안 만들기"}
                    </button>
                  </div>
                  {draft?.index === i && draft.status === "error" && (
                    <p role="alert" className="mt-2 text-sm text-red-700">
                      {draft.message}
                    </p>
                  )}
                  {draft?.index === i && draft.status === "done" && (
                    <DraftPanel draft={draft.data} />
                  )}
                </li>
              ))}
            </ol>
          )}

          {state.data.droppedCount > 0 && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              원문에서 근거를 확인하지 못한 문장 {state.data.droppedCount}개는 뺐습니다.
            </p>
          )}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            후보 제목은 AI가 아래 근거를 묶어 쓴 표현입니다. 판단 전에 근거 원문과 법제처 원문을 직접 확인해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}

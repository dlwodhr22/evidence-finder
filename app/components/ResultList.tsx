"use client";
// PLAN 작업 13: ② 확인된 자료 목록.
// Design Ref: §3.3 ② — 항목마다 법령명·조문 또는 사건번호와 출처 링크, 법령은 현행 여부와 시행일,
//   근거로 쓸 자료 선택 칸, 결과가 없으면 "찾지 못했다" 안내, 접어 둔 "검증 실패 항목",
//   따로 표시하는 "참고, 검증 안 됨" 질의회신(제목·링크만).
// PRD 5번 A — 목록에는 법제처에서 확인된 자료만 오른다(서버가 이미 걸렀다). 웹 문장은 보여주지 않는다.
import type { FeedbackResult } from "../lib/feedback";
import { isGovernmentLink, isLawGoKrUrl, siteName } from "../lib/links";
import { mergeVerified, resultKey, type SearchResults } from "../lib/results";
import type { VerifiedItem } from "../lib/types";
import type { FailedClue } from "../lib/verify";
import type { EvidenceState } from "./evidence-types";
import FeedbackDialog from "./FeedbackDialog";

const GROUPS: { kind: keyof SearchResults; label: string }[] = [
  { kind: "statutes", label: "법령" },
  { kind: "ordinances", label: "조례·규칙" },
  { kind: "cases", label: "판례·헌법재판소 결정" },
  { kind: "interpretations", label: "법령해석례" },
  { kind: "tribunals", label: "행정심판례" },
];

const CLUE_KIND_LABELS: Record<FailedClue["clue"]["kind"], string> = {
  prec: "판례",
  detc: "헌재 결정",
  expc: "법령해석례",
  decc: "행정심판례",
  law: "법령 조문",
};

/** 항목의 제목 아래에 보여줄 출처 정보 한 줄 */
function citationOf(item: VerifiedItem): string {
  switch (item.kind) {
    case "law":
      return [item.lawType, item.authority, item.article ? `${item.article}${item.articleTitle ? `(${item.articleTitle})` : ""}` : ""]
        .filter(Boolean)
        .join(" · ");
    case "case":
      return `${item.court} ${item.decisionDate} 선고 ${item.caseNumber} ${item.decisionType}`;
    case "interpretation":
      return `안건번호 ${item.caseNumber} · 회신 ${item.decisionDate} · ${item.authority}${item.requester ? ` (질의: ${item.requester})` : ""}`;
    case "tribunal":
      return `${item.authority} · 재결 ${item.decisionDate} · 사건번호 ${item.caseNumber}`;
  }
}

/** 단서 한 줄(검증 실패 항목용) */
function clueText(f: FailedClue): string {
  const c = f.clue;
  if (c.kind === "law") return `${c.lawName} ${c.article}`;
  return [c.court, c.caseNumber, c.decisionDate].filter(Boolean).join(" ");
}

interface ResultListProps {
  state: EvidenceState;
  selected: Map<string, VerifiedItem>;
  onToggle: (item: VerifiedItem) => void;
  onOpen: (item: VerifiedItem) => void; // ③ 원문 확인에서 열기
  /** 신고 후 다시 대조한 결과: 고쳐진 항목, 또는 확인되지 않아 뺀 항목 */
  overrides: Record<string, Override>;
  onReport: (item: VerifiedItem, result: FeedbackResult) => void;
}

export type Override = { type: "corrected"; item: VerifiedItem } | { type: "removed"; item: VerifiedItem };

export default function ResultList({ state, selected, onToggle, onOpen, overrides, onReport }: ResultListProps) {
  const { search, clues } = state;

  if (search.status === "idle") {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">① 사안을 입력하고 [근거 찾기]를 누르면 여기에 목록이 나옵니다.</p>;
  }
  if (search.status === "loading") {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">법제처에서 찾고 있습니다…</p>;
  }
  if (search.status === "error") {
    return <p role="alert" className="text-sm text-red-700">{search.message}</p>;
  }

  const verified = clues.status === "done" ? clues.data.verified : [];
  const webKeys = new Set(verified.map(resultKey));
  const mergedRaw = mergeVerified(search.data.results, verified);
  // 신고 후 다시 대조한 결과를 반영한다: 고친 항목은 바꾸고, 확인되지 않은 항목은 목록에서 뺀다.
  const merged = Object.fromEntries(
    (Object.keys(mergedRaw) as (keyof SearchResults)[]).map((kind) => [
      kind,
      (mergedRaw[kind] as VerifiedItem[]).flatMap((item) => {
        const o = overrides[resultKey(item)];
        if (!o) return [item];
        return o.type === "removed" ? [] : [o.item];
      }),
    ]),
  ) as unknown as SearchResults;
  const removedByReport = Object.values(overrides).filter((o) => o.type === "removed").map((o) => o.item);
  const total = GROUPS.reduce((n, g) => n + merged[g.kind].length, 0);
  const failed = clues.status === "done" ? clues.data.failed : [];
  const references = clues.status === "done" ? clues.data.references.filter((r) => isGovernmentLink(r.url)) : [];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        법제처에서 확인된 자료 <strong>{total}건</strong>
        {clues.status === "loading" && " · 웹 사례 단서를 확인하는 중이라 조금 뒤 더 늘어날 수 있습니다"}
        {selected.size > 0 && ` · 근거로 선택 ${selected.size}건`}
      </p>

      {!search.data.ordinancesRequested && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          조례·규칙은 찾지 않았습니다. 필요하면 사안이나 쟁점에 &quot;조례까지 검색해줘&quot;라고 적고 다시 찾아 주세요.
        </p>
      )}

      {total === 0 && clues.status !== "loading" && (
        <p className="rounded-md border border-black/10 bg-zinc-50 p-3 text-sm font-medium dark:border-white/15 dark:bg-zinc-900">
          법제처에서 확인된 자료를 찾지 못했습니다. 사안을 더 구체적으로 적거나 쟁점을 바꿔 다시 찾아 보세요.
        </p>
      )}

      {GROUPS.map(({ kind, label }) => {
        const items = merged[kind] as VerifiedItem[];
        if (items.length === 0) return null;
        return (
          <section key={kind} aria-labelledby={`group-${kind}`}>
            <h3 id={`group-${kind}`} className="mb-2 font-semibold">
              {label} <span className="text-sm font-normal text-zinc-500">{items.length}건</span>
            </h3>
            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const key = resultKey(item);
                const checkboxId = `pick-${key}`;
                const link = isLawGoKrUrl(item.sourceUrl) ? item.sourceUrl : "";
                return (
                  <li key={key} className="rounded-md border border-black/10 p-3 dark:border-white/15">
                    <div className="flex items-start gap-3">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => onToggle(item)}
                        // 법령은 근거로 쓸 조문을 정해야 한다. 조문은 [원문 확인]에서 골라 선택한다.
                        disabled={item.kind === "law" && !item.article}
                        className="mt-1 h-4 w-4 shrink-0"
                        aria-describedby={`${checkboxId}-meta`}
                      />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={checkboxId} className="cursor-pointer font-medium break-words">
                          {item.title}
                        </label>
                        <p id={`${checkboxId}-meta`} className="mt-0.5 text-sm text-zinc-600 break-words dark:text-zinc-400">
                          {citationOf(item)}
                        </p>
                        {item.kind === "law" && !item.article && (
                          <p className="mt-0.5 text-xs text-zinc-500">
                            법령은 [원문 확인]에서 조문을 고른 뒤 &quot;이 조문을 근거로 선택&quot;을 눌러 주세요.
                          </p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          {item.kind === "law" && (
                            <>
                              {/* PRD 성공 기준 4 — 폐지·개정 전이나 시행 전 법령을 현행처럼 보여주지 않는다 */}
                              <span
                                className={
                                  "rounded px-1.5 py-0.5 font-medium " +
                                  (!item.isCurrent
                                    ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                                    : item.notYetEffective
                                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                                      : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200")
                                }
                              >
                                {!item.isCurrent ? "현행 아님" : item.notYetEffective ? "시행 예정" : "현행"}
                              </span>
                              <span className="text-zinc-600 dark:text-zinc-400">
                                시행 {item.effectiveDate}
                                {item.isCurrent && item.notYetEffective && " (아직 시행 전)"}
                              </span>
                            </>
                          )}
                          {webKeys.has(key) && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                              웹 사례 단서 → 법제처 확인
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onOpen(item);
                              document.getElementById("document-view")?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                            className="rounded border border-blue-600 px-1.5 py-0.5 font-medium text-blue-700 dark:border-blue-400 dark:text-blue-300"
                          >
                            원문 확인
                          </button>
                          {link ? (
                            <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline dark:text-blue-300">
                              법제처 원문 보기 ↗
                            </a>
                          ) : (
                            <span className="text-red-700">출처 링크를 확인할 수 없습니다</span>
                          )}
                          <FeedbackDialog item={item} onResult={(r) => onReport(item, r)} />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {clues.status === "error" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{clues.message} 법제처에서 직접 찾은 결과만 보여드립니다.</p>
      )}

      {/* 참고, 검증 안 됨 — 제목과 링크만 */}
      {references.length > 0 && (
        <section aria-labelledby="refs" className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
          <h3 id="refs" className="font-semibold text-amber-900 dark:text-amber-100">
            참고, 검증 안 됨 · 정부 사이트 질의회신 {references.length}건
          </h3>
          <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
            법제처에서 확인할 수 없는 자료입니다. 근거로 쓰지 말고, 필요하면 링크를 열어 직접 확인하세요.
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {references.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all dark:text-blue-300">
                  {r.title}
                </a>{" "}
                <span className="text-xs text-zinc-600 dark:text-zinc-400">({siteName(r.url)})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 검증 실패 항목 — 접어 둔다 */}
      {failed.length + removedByReport.length > 0 && (
        <details className="rounded-md border border-black/10 p-3 text-sm dark:border-white/15">
          <summary className="cursor-pointer font-medium">
            검증 실패 항목 {failed.length + removedByReport.length}건 (근거로 쓰지 않음)
          </summary>
          {removedByReport.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {removedByReport.map((item) => (
                <li key={resultKey(item)} className="text-zinc-700 dark:text-zinc-300">
                  <span className="text-zinc-500">[신고]</span> {item.title} — 신고 후 법제처에서 다시 확인하지 못했습니다.
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            웹에서 찾았지만 법제처에서 확인되지 않은 단서입니다. 실제로 없거나, 번호·날짜가 다르게 알려진 것일 수 있습니다.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {failed.map((f, i) => (
              <li key={`${f.clue.kind}-${i}`} className="text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500">[{CLUE_KIND_LABELS[f.clue.kind]}]</span> {clueText(f)} — {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

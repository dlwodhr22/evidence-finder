"use client";
// PLAN 작업 14: ③ 원문 확인. 목록에서 고른 항목의 법제처 원문을 그대로 보여주고,
// 원문과 구분한 상자에 AI 요약을 따로 보여준다(요약 문장은 원문 구절이 확인된 것만).
// CLAUDE.md §4-6·7 — 원문은 고쳐 쓰지 않는다. 원문을 못 가져오면 요약하지 않고 오류를 알린다.
//
// 부모가 key를 항목마다 다르게 주어, 항목을 바꾸면 이 화면이 새로 시작된다.
import { useEffect, useState } from "react";
import { buildSourceAndOriginalText, buildSourceText } from "../lib/copy-text";
import type { FeedbackResult } from "../lib/feedback";
import FeedbackDialog from "./FeedbackDialog";
import { refOf, type DocumentView, type SummaryView } from "../lib/document-types";
import { isLawGoKrUrl } from "../lib/links";
import { resultKey } from "../lib/results";
import type { VerifiedItem } from "../lib/types";

const COPY_BUTTON = "rounded-md border border-black/15 px-2 py-1 text-sm dark:border-white/20";

type Loaded<T> = { key: string; result: { ok: true; data: T } | { ok: false; message: string } };

async function getJson<T>(url: string): Promise<Loaded<T>["result"]> {
  try {
    const res = await fetch(url);
    const json: unknown = await res.json();
    if (res.ok && typeof json === "object" && json !== null && "data" in json) {
      return { ok: true, data: (json as { data: T }).data };
    }
    const message =
      typeof json === "object" && json !== null && "error" in json
        ? String((json as { error: { message?: string } }).error.message ?? "")
        : "";
    return { ok: false, message: message || "불러오지 못했습니다." };
  } catch {
    return { ok: false, message: "네트워크 문제로 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요." };
  }
}

export default function DocumentViewer({
  item,
  onClose,
  onReport,
  removed,
  pickedKeys,
  onPick,
}: {
  item: VerifiedItem;
  /** 근거로 선택된 자료의 열쇠 */
  pickedKeys: Set<string>;
  /** 근거로 선택하거나 선택을 푼다 */
  onPick: (item: VerifiedItem) => void;
  /** 신고 후 다시 대조했지만 법제처에서 확인되지 않은 자료 */
  removed: boolean;
  onClose: () => void;
  onReport: (result: FeedbackResult) => void;
}) {
  const base = refOf(item);
  const [article, setArticle] = useState(base.article ?? "");

  const params = new URLSearchParams({ kind: base.kind, id: base.id });
  if (base.source) params.set("source", base.source);
  if (article) params.set("article", article);
  const query = params.toString();

  const [doc, setDoc] = useState<Loaded<DocumentView> | null>(null);
  const [summary, setSummary] = useState<Loaded<SummaryView> | null>(null);

  // 원문
  useEffect(() => {
    let cancelled = false;
    getJson<DocumentView>(`/api/document?${query}`).then((result) => {
      if (!cancelled) setDoc({ key: query, result });
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // 조문을 바꾸는 동안에도 조문 목록 상자가 사라지지 않도록, 마지막으로 받은 원문 정보를 따로 둔다.
  const lastDoc = doc?.result.ok ? doc.result.data : null;
  const docReady = doc?.key === query && doc.result.ok ? doc.result.data : null;
  const hasText = !!docReady && docReady.sections.length > 0;

  // 요약: 원문이 화면에 올라온 뒤에만 요청한다
  useEffect(() => {
    if (!hasText) return;
    let cancelled = false;
    getJson<SummaryView>(`/api/document?${query}&summary=1`).then((result) => {
      if (!cancelled) setSummary({ key: query, result });
    });
    return () => {
      cancelled = true;
    };
  }, [query, hasText]);

  // 복사: 눌렀다는 표시는 잠깐만 보여준다
  const [copied, setCopied] = useState<"source" | "original" | null>(null);
  const [copyError, setCopyError] = useState(false);
  async function copy(which: "source" | "original", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(false);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
      setCopyError(true);
    }
  }

  // 근거로 선택할 대상: 법령은 지금 보는 조문을 붙인 항목, 그 밖의 자료는 항목 그대로
  const pickTarget: VerifiedItem =
    item.kind === "law" && docReady?.currentArticle
      ? {
          ...item,
          article: docReady.currentArticle,
          articleTitle: docReady.articles?.find((a) => a.label === docReady.currentArticle)?.title || undefined,
        }
      : item;

  const docState = doc?.key === query ? doc.result : null;
  const summaryState = summary?.key === query ? summary.result : null;
  const link = isLawGoKrUrl(docReady?.sourceUrl ?? item.sourceUrl) ? (docReady?.sourceUrl ?? item.sourceUrl) : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold break-words">{item.title}</h3>
          {docReady && <p className="text-sm text-zinc-600 break-words dark:text-zinc-400">{docReady.citation}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-black/15 px-2 py-1 text-sm dark:border-white/20"
        >
          닫기
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline dark:text-blue-300">
            법제처 원문 보기 ↗
          </a>
        ) : (
          <p className="text-sm text-red-700">출처 링크를 확인할 수 없습니다</p>
        )}
        {docReady && (
          <FeedbackDialog
            item={item}
            article={article || undefined}
            allowSummary={hasText && summaryState !== null}
            onResult={(r) => {
              // 요약 신고: 이전 요약을 지우고 다시 대조해 만든 요약으로 바꾼다
              if (r.outcome === "summary" && r.summary) setSummary({ key: query, result: { ok: true, data: r.summary } });
              onReport(r);
            }}
          />
        )}
        {docReady && link && !removed && (
          <>
            <button type="button" onClick={() => copy("source", buildSourceText(item.title, docReady))} className={COPY_BUTTON}>
              {copied === "source" ? "복사됨 ✓" : "출처 복사"}
            </button>
            {hasText && (
              <button
                type="button"
                onClick={() => copy("original", buildSourceAndOriginalText(item.title, docReady))}
                className={COPY_BUTTON}
              >
                {copied === "original" ? "복사됨 ✓" : "출처와 원문 복사"}
              </button>
            )}
          </>
        )}
      </div>
      {/* 근거로 선택: 법령은 지금 보고 있는 조문을 근거로 고른다 */}
      {docReady && !removed && !docReady.notYetEffective && (item.kind !== "law" || item.isCurrent) && (item.kind !== "law" || docReady.currentArticle) && (
        <div>
          <button
            type="button"
            onClick={() => onPick(pickTarget)}
            aria-pressed={pickedKeys.has(resultKey(pickTarget))}
            className={
              "rounded-md border px-3 py-1.5 text-sm font-medium " +
              (pickedKeys.has(resultKey(pickTarget))
                ? "border-blue-700 bg-blue-700 text-white"
                : "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300")
            }
          >
            {pickedKeys.has(resultKey(pickTarget))
              ? `근거로 선택됨 ✓ (누르면 해제)`
              : item.kind === "law"
                ? `이 조문(${docReady.currentArticle})을 근거로 선택`
                : "이 자료를 근거로 선택"}
          </button>
        </div>
      )}
      {item.kind === "law" && !item.isCurrent && (
        <p className="text-sm text-red-700">현행이 아닌 법령(폐지·개정 전)은 근거로 선택할 수 없습니다.</p>
      )}
      {docReady?.notYetEffective && (
        <p className="text-sm text-amber-800 dark:text-amber-200">아직 시행 전인 조문은 근거로 선택할 수 없습니다.</p>
      )}
      {removed && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          신고 후 법제처에서 이 자료를 다시 확인하지 못했습니다. 근거로 쓰지 마세요. 복사 버튼은 사용할 수 없습니다.
        </p>
      )}
      {copyError && (
        <p role="alert" className="text-sm text-red-700">
          복사하지 못했습니다. 원문을 직접 선택해서 복사해 주세요.
        </p>
      )}
      {docReady && hasText && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">복사에는 법제처 원문과 출처만 담깁니다. AI 요약은 들어가지 않습니다.</p>
      )}

      {!docState && <p className="text-sm text-zinc-600 dark:text-zinc-400">법제처에서 원문을 가져오는 중입니다…</p>}

      {docState && !docState.ok && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          {docState.message} 원문을 가져오지 못해 요약은 표시하지 않습니다.
        </p>
      )}

      {lastDoc && (
        <>
          {/* 법령은 조문을 골라야 원문이 나온다 */}
          {lastDoc.articles && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">조문 선택</span>
              <select
                value={article}
                onChange={(e) => setArticle(e.target.value)}
                className="rounded-md border border-black/15 bg-transparent p-2 dark:border-white/20"
              >
                <option value="">조문을 고르세요</option>
                {lastDoc.articles.map((a) => (
                  <option key={a.label} value={a.label}>
                    {a.label}
                    {a.title ? ` ${a.title}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(docReady?.warnings ?? []).map((w) => (
            <p key={w} className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {w}
            </p>
          ))}

          {/* 법제처 원문 */}
          {hasText && (
            <section aria-labelledby="doc-original" className="rounded-md border border-black/15 p-3 dark:border-white/20">
              <h4 id="doc-original" className="mb-2 text-sm font-semibold">
                법제처 원문 (그대로)
              </h4>
              <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
                {docReady?.sections.map((s) => (
                  <div key={s.heading}>
                    <p className="text-xs font-semibold text-zinc-500">{s.heading}</p>
                    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{s.text}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI 요약 — 원문과 구분 */}
          {hasText && (
            <section
              aria-labelledby="doc-summary"
              className="rounded-md border border-dashed border-blue-400 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-950"
            >
              <h4 id="doc-summary" className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                AI 요약 (참고용 · 원문이 아닙니다)
              </h4>
              {!summaryState && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">요약하고 원문과 대조하는 중입니다…</p>}
              {summaryState && !summaryState.ok && (
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">요약을 표시하지 않습니다. {summaryState.message}</p>
              )}
              {summaryState?.ok && summaryState.data.sentences.length === 0 && (
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">원문과 대조되는 요약 문장이 없어 요약을 표시하지 않습니다. 위 원문을 직접 확인해 주세요.</p>
              )}
              {summaryState?.ok && summaryState.data.sentences.length > 0 && (
                <>
                  <ul className="mt-2 flex flex-col gap-2">
                    {summaryState.data.sentences.map((s, i) => (
                      <li key={i} className="text-sm">
                        <p>{s.text}</p>
                        <p className="mt-0.5 text-xs text-zinc-600 break-words dark:text-zinc-400">근거 원문: “{s.quote}”</p>
                      </li>
                    ))}
                  </ul>
                  {summaryState.data.droppedCount > 0 && (
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      원문에서 근거를 확인하지 못한 문장 {summaryState.data.droppedCount}개는 뺐습니다.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

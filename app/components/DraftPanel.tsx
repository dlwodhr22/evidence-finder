"use client";
// PLAN 작업 18: 회신 초안 표시. 공문 형식(제목, 경위, 검토 결과, 회신 내용)으로 보여주고,
// 복사 버튼을 둔다. 초안임을 늘 표시한다(CLAUDE.md §4-8).
import { useState } from "react";
import { buildDraftText } from "../lib/copy-text";
import { CASE_SOURCE_ID, DRAFT_NOTICE, type DraftSentence, type DraftView } from "../lib/draft-types";
import { isLawGoKrUrl } from "../lib/links";

function Sentence({ s }: { s: DraftSentence }) {
  return (
    <li className="text-sm">
      <p className="break-words">{s.text}</p>
      <p className="mt-0.5 text-xs break-words text-zinc-600 dark:text-zinc-400">
        근거 원문: “{s.quote}”
        <br />
        출처: {s.source.id === CASE_SOURCE_ID ? "입력한 사안" : `${s.source.title} · ${s.source.citation}`}
        {isLawGoKrUrl(s.source.sourceUrl) && (
          <>
            {" "}
            <a href={s.source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline dark:text-blue-300">
              법제처 원문 ↗
            </a>
          </>
        )}
      </p>
    </li>
  );
}

function Block({ heading, items }: { heading: string; items: DraftSentence[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4 className="text-sm font-semibold">{heading}</h4>
      <ul className="mt-1 flex flex-col gap-2">
        {items.map((s, i) => (
          <Sentence key={i} s={s} />
        ))}
      </ul>
    </section>
  );
}

export default function DraftPanel({ draft }: { draft: DraftView }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildDraftText(draft));
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md border-2 border-dashed border-amber-500 p-3">
      <p role="note" className="rounded-md bg-amber-100 p-2 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {DRAFT_NOTICE}
      </p>
      <h3 className="font-semibold break-words">제목: {draft.title}</h3>
      <Block heading="1. 경위" items={draft.background} />
      <Block heading="2. 검토 결과" items={draft.review} />
      <Block heading="3. 회신 내용" items={draft.reply} />

      {draft.sources.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold">붙임(근거 자료)</h4>
          <ol className="mt-1 list-decimal pl-5 text-sm">
            {draft.sources.map((s) => (
              <li key={s.id} className="break-words">
                {s.title} ({s.citation})
              </li>
            ))}
          </ol>
        </section>
      )}

      {draft.droppedCount > 0 && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">원문에서 근거를 확인하지 못한 문장 {draft.droppedCount}개는 뺐습니다.</p>
      )}
      {copyError && (
        <p role="alert" className="text-sm text-red-700">
          복사하지 못했습니다. 글을 직접 선택해서 복사해 주세요.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20">
          {copied ? "복사됨 ✓" : "초안 복사"}
        </button>
      </div>
    </div>
  );
}

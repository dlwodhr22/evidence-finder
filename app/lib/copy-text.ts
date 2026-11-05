// PLAN 작업 15: 복사 버튼이 클립보드에 넣을 글을 만든다.
// 직원이 이 글을 내부망으로 옮겨 쓰므로, 법제처 원문과 출처만 담는다.
// AI 요약은 원문이 아니므로 복사 글에 넣지 않는다(CLAUDE.md §4-6). 원문은 고쳐 쓰지 않는다.
import type { DocumentView } from "./document-types";
import { CASE_SOURCE_ID, DRAFT_NOTICE, type DraftSentence, type DraftView } from "./draft-types";

/** 출처만 복사: 제목, 출처 한 줄, 법제처 링크 */
export function buildSourceText(title: string, doc: Pick<DocumentView, "citation" | "sourceUrl">): string {
  return [title, doc.citation, `출처: 법제처 ${doc.sourceUrl}`].filter((line) => line.trim() !== "").join("\n");
}

/** 출처와 원문 복사: 출처 아래에 법제처 원문을 그대로 붙인다 */
export function buildSourceAndOriginalText(title: string, doc: DocumentView): string {
  const original = doc.sections
    .map((s) => (doc.sections.length > 1 ? `【${s.heading}】\n${s.text}` : s.text))
    .join("\n\n");
  return `${buildSourceText(title, doc)}\n\n[법제처 원문]\n${original}`;
}

/** 회신 초안을 공문 형식 글로 만든다. 초안 표시와 근거 목록을 함께 담는다. */
export function buildDraftText(draft: DraftView): string {
  const refOf = (s: DraftSentence): string => {
    if (s.source.id === CASE_SOURCE_ID) return "";
    const n = draft.sources.findIndex((x) => x.id === s.source.id) + 1;
    return n > 0 ? ` [근거 ${n}]` : "";
  };
  const block = (heading: string, items: DraftSentence[]): string =>
    items.length === 0 ? "" : `${heading}\n${items.map((s) => `- ${s.text}${refOf(s)}`).join("\n")}`;
  const sources = draft.sources.map((s, i) => `${i + 1}. ${s.title} (${s.citation}) 법제처 ${s.sourceUrl}`).join("\n");
  return [
    `※ ${DRAFT_NOTICE}`,
    `제목: ${draft.title}`,
    block("1. 경위", draft.background),
    block("2. 검토 결과", draft.review),
    block("3. 회신 내용", draft.reply),
    sources ? `붙임(근거 자료)\n${sources}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

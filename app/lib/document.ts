// PLAN 작업 14: 선택한 항목의 법제처 원문을 가져오고, 원문 구절로 확인된 AI 요약을 만든다.
// Design Ref: §4.2 / §5 GET /api/document — 원문은 고쳐 쓰지 않고, 요약은 원문과 구분해 따로 돌려준다.
// CLAUDE.md §4-6·7 — 원문을 가져오지 못하면 요약하지 않고 오류를 알린다.
//
// 서버 전용 파일이다.
import { z } from "zod";
import { groundedSentenceSchema, askAiJson, keepGroundedSentences, type AiResult } from "./ai";
import { caseFullText, getCase, type CaseDocument } from "./cases";
import type { ArticleChoice, DocumentRef, DocumentSection, DocumentView, SummaryView } from "./document-types";
import { getOrdinance, getStatute, findArticle, parseArticleLabel, type LawDocument } from "./laws";
import { getRuling, rulingFullText, type RulingDocument } from "./rulings";
import { lawApiFailure, type LawApiResult } from "./law-api";

/** 요약에 쓰는 원문 길이 한도(글자 수). 넘으면 앞부분만 AI에게 주고, 요약도 그 범위 안에서만 확인한다. */
export const MAX_SUMMARY_CHARS = 12_000;
const SUMMARY_SOURCE_ID = "doc";
const MAX_SUMMARY_SENTENCES = 5;

/** 입력(쿼리 값)이 올바른 모양인지 확인한다. 틀리면 null. */
export function parseDocumentRef(params: { kind?: string | null; source?: string | null; id?: string | null; article?: string | null }): DocumentRef | null {
  const { kind, source, id, article } = params;
  if (!id || !/^\d{1,12}$/.test(id)) return null;
  if (kind === "law" && (source === "law" || source === "ordin")) {
    const label = article?.trim();
    if (label && !parseArticleLabel(label)) return null;
    return { kind, source, id, ...(label ? { article: label } : {}) };
  }
  if (kind === "case" && (source === "prec" || source === "detc")) return { kind, source, id };
  if (kind === "interpretation" || kind === "tribunal") return { kind, id };
  return null;
}

type Loaded = { view: DocumentView; fullText: string };

function lawView(doc: LawDocument, articleLabelWanted: string | undefined): LawApiResult<Loaded> {
  const articles: ArticleChoice[] = doc.articles.map((a) => ({ label: a.label, title: a.title }));
  const base = {
    title: doc.title,
    sourceUrl: doc.sourceUrl,
    articles,
  };
  if (!articleLabelWanted) {
    return {
      ok: true,
      data: {
        view: {
          ...base,
          citation: [doc.lawType, doc.authority, `시행 ${doc.effectiveDate}`].filter(Boolean).join(" · "),
          sections: [],
          warnings: [],
        },
        fullText: "",
      },
    };
  }
  const article = findArticle(doc, articleLabelWanted);
  if (!article) return lawApiFailure("BAD_RESPONSE");
  const warnings: string[] = [];
  if (article.notYetEffective) warnings.push(`이 조문은 아직 시행 전입니다(시행 예정 ${article.effectiveDate}).`);
  for (const part of article.pendingParts) warnings.push(`아직 시행되지 않은 부분이 있습니다: ${part}`);
  return {
    ok: true,
    data: {
      view: {
        ...base,
        citation: [doc.lawType, doc.authority, `${article.label}${article.title ? `(${article.title})` : ""}`].filter(Boolean).join(" · "),
        sections: [{ heading: article.label, text: article.text }],
        currentArticle: article.label,
        warnings,
      },
      fullText: article.text,
    },
  };
}

function sectionsView(
  doc: CaseDocument | RulingDocument,
  citation: string,
  fullText: string,
): LawApiResult<Loaded> {
  const sections: DocumentSection[] = doc.sections.map((s) => ({ heading: s.heading, text: s.text }));
  return { ok: true, data: { view: { title: doc.title, citation, sourceUrl: doc.sourceUrl, sections, warnings: [] }, fullText } };
}

/** 법제처에서 원문을 가져온다. 가져오지 못하면 실패로 돌려준다(요약하지 않음). */
export async function loadDocument(ref: DocumentRef): Promise<LawApiResult<Loaded>> {
  if (ref.kind === "law") {
    const doc = ref.source === "ordin" ? await getOrdinance(ref.id) : await getStatute(ref.id);
    if (!doc.ok) return doc;
    return lawView(doc.data, ref.article);
  }
  if (ref.kind === "case") {
    if (ref.source !== "prec" && ref.source !== "detc") return lawApiFailure("BAD_RESPONSE");
    const doc = await getCase(ref.source, ref.id);
    if (!doc.ok) return doc;
    const d = doc.data;
    return sectionsView(d, `${d.court} ${d.decisionDate} 선고 ${d.caseNumber}`, caseFullText(d));
  }
  const doc = await getRuling(ref.kind === "interpretation" ? "expc" : "decc", ref.id);
  if (!doc.ok) return doc;
  const d = doc.data;
  const citation =
    ref.kind === "interpretation"
      ? `안건번호 ${d.caseNumber} · 회신 ${d.decisionDate}${d.authority ? ` · ${d.authority}` : ""}`
      : `${d.authority ? `${d.authority} · ` : ""}재결 ${d.decisionDate} · 사건번호 ${d.caseNumber}`;
  return sectionsView(d, citation, rulingFullText(d));
}

// ─────────────────────────────────────────────────────────────
// AI 요약 (원문 구절로 확인된 문장만)
// ─────────────────────────────────────────────────────────────

const summarySchema = z.object({
  sentences: z.array(groundedSentenceSchema).max(MAX_SUMMARY_SENTENCES),
});

/** AI에게 줄 원문 범위. 너무 길면 앞부분만 쓴다. */
export function summarySourceText(fullText: string): string {
  return fullText.length > MAX_SUMMARY_CHARS ? fullText.slice(0, MAX_SUMMARY_CHARS) : fullText;
}

/**
 * AI가 낸 문장 중 근거 구절이 원문에 글자 그대로 있는 것만 남긴다.
 * 자료 번호는 AI가 쓴 값을 믿지 않고 이 원문 하나로 고정한다.
 */
export function groundSummary(
  sentences: { text: string; quote: string }[],
  sourceText: string,
): SummaryView {
  const pinned = sentences.map((s) => ({ text: s.text.trim(), quote: s.quote.trim(), sourceId: SUMMARY_SOURCE_ID }));
  const { kept, dropped } = keepGroundedSentences(
    pinned.filter((s) => s.text !== ""),
    { [SUMMARY_SOURCE_ID]: sourceText },
  );
  return { sentences: kept.map((s) => ({ text: s.text, quote: s.quote })), droppedCount: dropped.length };
}

/** 원문을 요약한다. 원문이 비어 있으면 요약하지 않는다. */
export async function summarizeDocument(fullText: string): Promise<AiResult<SummaryView>> {
  const source = summarySourceText(fullText);
  if (source.trim() === "") {
    return { ok: false, error: { code: "BAD_OUTPUT", message: "요약할 원문이 없습니다." } };
  }
  const result = await askAiJson({
    instructions: [
      `아래 [원문]만 근거로 핵심을 ${MAX_SUMMARY_SENTENCES}문장 이하로 요약한다.`,
      "각 문장마다 근거가 되는 원문 구절(quote)을 원문에서 글자 그대로 복사해 함께 낸다. 고쳐 쓰거나 줄이지 않는다.",
      `sourceId는 항상 "${SUMMARY_SOURCE_ID}"로 쓴다.`,
      "원문에 없는 내용, 다른 법령·판례, 결론이나 의견을 쓰지 않는다.",
    ].join("\n"),
    input: `[원문]\n${source}`,
    schema: summarySchema,
    schemaName: "document_summary",
  });
  if (!result.ok) return result;
  return { ok: true, data: groundSummary(result.data.sentences, source) };
}

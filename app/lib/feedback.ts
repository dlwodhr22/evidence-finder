// PLAN 작업 16: "잘못된 결과 신고" — 신고된 항목을 법제처 원문과 다시 대조해 바로잡는다.
// Design Ref: §4.4 — 신고 이유 3가지(없는 자료·번호/조문 틀림 / 요약·인용이 원문과 다름 / 폐지·개정 법령).
// PRD 5번 A — 신고 내용은 저장하지 않는다. 이 파일은 받은 값으로 법제처에 다시 묻고 결과만 돌려준다.
// 원칙: 화면의 값은 믿지 않고, 법제처에서 다시 가져온 값으로만 고친다.
//
// 서버 전용 파일이다.
import { z } from "zod";
import { getCase } from "./cases";
import { loadDocument, summarizeDocument } from "./document";
import type { SummaryView } from "./document-types";
import type { LawApiResult } from "./law-api";
import { findArticle, getOrdinance, getStatute, searchOrdinances, searchStatutes, todayInKorea } from "./laws";
import { getRuling } from "./rulings";
import type { CaseItem, InterpretationItem, LawItem, TribunalItem, VerifiedItem } from "./types";

export const FEEDBACK_REASONS = ["wrong", "summary", "outdated"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type FeedbackOutcome =
  | "confirmed" // 다시 대조했더니 맞았다(바뀐 것 없음)
  | "corrected" // 법제처 기준으로 고쳤다
  | "removed" // 법제처에서 확인되지 않아 목록에서 뺀다
  | "summary" // 요약을 다시 만들었다
  | "unavailable"; // 법제처에 연결하지 못해 대조하지 못했다(아무것도 바꾸지 않음)

export interface FeedbackResult {
  outcome: FeedbackOutcome;
  message: string; // 사용자에게 보여줄 한 줄
  changes: string[]; // 무엇이 바뀌었는지
  item?: VerifiedItem; // corrected일 때 고쳐진 항목
  summary?: SummaryView; // summary일 때 다시 만든 요약
}

// ── 요청 검사 ─────────────────────────────────────────────

const text = z.string().max(500);
const id = z.string().regex(/^\d{1,12}$/);
const lawItem = z.object({
  kind: z.literal("law"),
  source: z.enum(["law", "ordin"]),
  id,
  title: text,
  lawType: text,
  authority: text,
  isCurrent: z.boolean(),
  effectiveDate: text,
  notYetEffective: z.boolean(),
  sourceUrl: text,
  article: text.optional(),
  articleTitle: text.optional(),
});
const caseItem = z.object({
  kind: z.literal("case"),
  source: z.enum(["prec", "detc"]),
  id,
  title: text,
  caseNumber: text,
  court: text,
  decisionDate: text,
  decisionType: text,
  sourceUrl: text,
});
const interpretationItem = z.object({
  kind: z.literal("interpretation"),
  id,
  title: text,
  caseNumber: text,
  authority: text,
  requester: text,
  decisionDate: text,
  sourceUrl: text,
});
const tribunalItem = z.object({
  kind: z.literal("tribunal"),
  id,
  title: text,
  caseNumber: text,
  authority: text,
  decisionDate: text,
  sourceUrl: text,
});

export const feedbackRequestSchema = z.object({
  reason: z.enum(FEEDBACK_REASONS),
  item: z.discriminatedUnion("kind", [lawItem, caseItem, interpretationItem, tribunalItem]),
  /** 요약 신고일 때 ③에서 보고 있던 조문 */
  article: text.optional(),
});
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// ── 도구 ──────────────────────────────────────────────────

/** 법제처에 닿지 못한 오류인지(없는 자료라서 실패한 것과 구분) */
function isConnectionProblem(code: string): boolean {
  return code !== "BAD_RESPONSE";
}

const UNAVAILABLE: FeedbackResult = {
  outcome: "unavailable",
  message: "법제처에 연결하지 못해 다시 대조하지 못했습니다. 잠시 뒤 다시 시도해 주세요. 목록은 바꾸지 않았습니다.",
  changes: [],
};

const REMOVED: FeedbackResult = {
  outcome: "removed",
  message: "법제처에서 이 자료를 다시 확인하지 못해 목록에서 뺐습니다. 근거로 쓰지 마세요.",
  changes: [],
};

/** 화면에 있던 값과 법제처에서 다시 가져온 값을 비교해 바뀐 점을 적는다 */
function diff(label: string, before: string, after: string, changes: string[]): void {
  if (before !== after) changes.push(`${label}: ${before || "(없음)"} → ${after || "(없음)"}`);
}

function done(item: VerifiedItem, changes: string[]): FeedbackResult {
  if (changes.length === 0) {
    return { outcome: "confirmed", message: "법제처 원문과 다시 대조했습니다. 바뀐 점은 없습니다.", changes, item };
  }
  return { outcome: "corrected", message: "법제처 원문과 다시 대조해 아래 내용을 고쳤습니다.", changes, item };
}

async function recheckLaw(item: LawItem, reason: "wrong" | "outdated"): Promise<FeedbackResult> {
  const doc = await (item.source === "ordin" ? getOrdinance(item.id) : getStatute(item.id));
  if (!doc.ok) return isConnectionProblem(doc.error.code) ? UNAVAILABLE : REMOVED;
  const d = doc.data;

  let article: ReturnType<typeof findArticle>;
  if (item.article) {
    article = findArticle(d, item.article);
    if (!article) return REMOVED; // 본문에 그 조문이 없다
  }

  const changes: string[] = [];
  const fixed: LawItem = { ...item, title: d.title, effectiveDate: d.effectiveDate };
  diff("이름", item.title, d.title, changes);

  if (reason === "outdated") {
    // 현행 여부는 법제처 검색 결과(현행연혁코드)로만 판단한다. 검색에서 같은 자료를 찾지 못하면 "현행 아님"으로 둔다.
    const found = await (item.source === "ordin" ? searchOrdinances(d.title, { display: 20 }) : searchStatutes(d.title, { display: 20 }));
    if (!found.ok) return UNAVAILABLE;
    const fresh = found.data.items.find((i) => i.id === item.id);
    fixed.isCurrent = fresh ? fresh.isCurrent : false;
    if (!fresh) changes.push("법제처 현행 목록에서 이 자료를 찾지 못해 '현행 아님'으로 표시합니다(더 새로운 개정본이 있을 수 있습니다).");
    diff("현행 여부", item.isCurrent ? "현행" : "현행 아님", fixed.isCurrent ? "현행" : "현행 아님", changes);
  }

  const today = todayInKorea();
  fixed.notYetEffective = d.effectiveDate > today || (article?.notYetEffective ?? false);
  diff("시행일", item.effectiveDate, fixed.effectiveDate, changes);
  if (item.notYetEffective !== fixed.notYetEffective) {
    changes.push(`시행 상태: ${item.notYetEffective ? "시행 예정" : "시행 중"} → ${fixed.notYetEffective ? "시행 예정" : "시행 중"}`);
  }
  if (article) fixed.articleTitle = article.title || undefined;
  return done(fixed, changes);
}

async function recheckCase(item: CaseItem): Promise<FeedbackResult> {
  const doc = await getCase(item.source, item.id);
  return compareRecord(doc, item, (d) => ({ ...item, title: d.title, caseNumber: d.caseNumber, court: d.court, decisionDate: d.decisionDate }), [
    ["사건명", "title"],
    ["사건번호", "caseNumber"],
    ["법원", "court"],
    ["선고일", "decisionDate"],
  ]);
}

async function recheckRuling(item: InterpretationItem | TribunalItem): Promise<FeedbackResult> {
  const doc = await getRuling(item.kind === "interpretation" ? "expc" : "decc", item.id);
  return compareRecord(
    doc,
    item,
    (d) => ({ ...item, title: d.title, caseNumber: d.caseNumber, authority: d.authority || item.authority, decisionDate: d.decisionDate }),
    [
      ["제목", "title"],
      ["번호", "caseNumber"],
      ["기관", "authority"],
      ["날짜", "decisionDate"],
    ],
  );
}

/** 판례·해석례·행정심판례: 법제처에서 다시 가져온 값으로 바꾸고 달라진 점을 적는다 */
function compareRecord<D, I extends VerifiedItem>(
  doc: LawApiResult<D>,
  item: I,
  rebuild: (d: D) => I,
  fields: [string, keyof I & string][],
): FeedbackResult {
  if (!doc.ok) return isConnectionProblem(doc.error.code) ? UNAVAILABLE : REMOVED;
  const fixed = rebuild(doc.data);
  const changes: string[] = [];
  for (const [label, key] of fields) diff(label, String(item[key]), String(fixed[key]), changes);
  return done(fixed, changes);
}

async function resummarize(req: FeedbackRequest): Promise<FeedbackResult> {
  const item = req.item;
  const ref =
    item.kind === "law"
      ? { kind: "law" as const, source: item.source, id: item.id, ...((req.article ?? item.article) ? { article: req.article ?? item.article } : {}) }
      : item.kind === "case"
        ? { kind: "case" as const, source: item.source, id: item.id }
        : { kind: item.kind, id: item.id };
  const loaded = await loadDocument(ref);
  if (!loaded.ok) return isConnectionProblem(loaded.error.code) ? UNAVAILABLE : REMOVED;
  const summary = await summarizeDocument(loaded.data.fullText);
  if (!summary.ok) {
    return { outcome: "summary", message: "요약을 다시 만들지 못해 요약 없이 원문만 보여드립니다.", changes: [], summary: { sentences: [], droppedCount: 0 } };
  }
  const empty = summary.data.sentences.length === 0;
  return {
    outcome: "summary",
    message: empty
      ? "원문과 대조되는 요약 문장이 없어 요약 없이 원문만 보여드립니다."
      : "이전 요약을 지우고, 원문과 한 문장씩 대조해 다시 요약했습니다.",
    changes: [],
    summary: summary.data,
  };
}

/** 신고를 처리한다. 신고 내용은 어디에도 저장하지 않는다. */
export async function reviewReport(req: FeedbackRequest): Promise<FeedbackResult> {
  const item = req.item;
  if (req.reason === "summary") return resummarize(req);
  if (req.reason === "outdated") {
    if (item.kind !== "law") {
      return { outcome: "confirmed", message: "판례·해석례·행정심판례에는 현행 여부가 없어 바꿀 것이 없습니다.", changes: [], item };
    }
    return recheckLaw(item, "outdated");
  }
  if (item.kind === "law") return recheckLaw(item, "wrong");
  if (item.kind === "case") return recheckCase(item);
  return recheckRuling(item);
}

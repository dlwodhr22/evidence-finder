// PLAN 작업 14: ③ 원문 확인 화면이 서버와 주고받는 모양. 화면(클라이언트)에서도 안전하게 불러 쓴다.
import type { VerifiedItem } from "./types";

/** 원문을 어떤 자료에서 가져올지 가리키는 값 */
export interface DocumentRef {
  kind: "law" | "case" | "interpretation" | "tribunal";
  source?: "law" | "ordin" | "prec" | "detc"; // 법령(law·ordin), 판례(prec·detc)만 필요
  id: string;
  article?: string; // 법령일 때 보여 줄 조문. 예: "제72조", "제8조의2"
}

/** 목록 항목에서 원문 요청 값을 만든다 */
export function refOf(item: VerifiedItem): DocumentRef {
  if (item.kind === "law") return { kind: "law", source: item.source, id: item.id, ...(item.article ? { article: item.article } : {}) };
  if (item.kind === "case") return { kind: "case", source: item.source, id: item.id };
  return { kind: item.kind, id: item.id };
}

/** 원문의 한 부분(법제처 원문 그대로) */
export interface DocumentSection {
  heading: string;
  text: string;
}

/** 법령에서 고를 수 있는 조문 */
export interface ArticleChoice {
  label: string; // 예: "제72조"
  title: string; // 예: "변상금의 징수"
}

/** 법제처에서 가져온 원문 */
export interface DocumentView {
  title: string;
  citation: string; // 출처 한 줄(법령명·조문 또는 사건번호 등)
  sourceUrl: string; // 법제처 공개 링크
  sections: DocumentSection[]; // 조문을 아직 고르지 않은 법령은 빈 목록
  articles?: ArticleChoice[]; // 법령일 때 고를 수 있는 조문 목록
  currentArticle?: string; // 지금 보여 주는 조문
  warnings: string[]; // 시행 예정 등 주의 문구
  notYetEffective?: boolean; // 보여 주는 조문이 아직 시행 전이면 true (근거로 쓸 수 없다)
}

/** AI 요약 문장 한 개와 그 근거가 된 원문 구절 */
export interface SummarySentence {
  text: string;
  quote: string;
}

export interface SummaryView {
  sentences: SummarySentence[]; // 원문 구절이 확인된 문장만
  droppedCount: number; // 원문에서 확인되지 않아 뺀 문장 수
}

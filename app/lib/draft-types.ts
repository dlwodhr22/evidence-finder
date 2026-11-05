// PLAN 작업 18: 회신 초안이 서버와 화면 사이에서 오가는 모양. 화면(클라이언트)에서도 안전하게 불러 쓴다.
import type { CandidateSource } from "./candidate-types";

/** 사안 입력에서 가져온 문장의 출처(경위는 입력한 사안에서만 쓴다) */
export const CASE_SOURCE_ID = "case";

/** 초안의 문장 하나와, 그 근거가 된 원문 구절 */
export interface DraftSentence {
  text: string;
  quote: string; // 법제처 원문(또는 입력한 사안)에 글자 그대로 있는 구절
  source: CandidateSource; // 사안이면 id가 "case"
}

/** 공문 형식 회신 초안: 제목, 경위, 검토 결과, 회신 내용 */
export interface DraftView {
  title: string;
  background: DraftSentence[]; // 경위 — 입력한 사안에서만
  review: DraftSentence[]; // 검토 결과 — 고른 자료에서
  reply: DraftSentence[]; // 회신 내용
  sources: CandidateSource[]; // 실제로 근거로 쓴 법제처 자료(붙임 근거)
  droppedCount: number; // 원문에서 근거를 확인하지 못해 뺀 문장 수
}

export const DRAFT_NOTICE = "이 문서는 초안입니다. 담당자가 근거 원문을 직접 확인하고 검토한 뒤 사용하세요.";

// PLAN 작업 17: 판단 후보가 서버와 화면 사이에서 오가는 모양. 화면(클라이언트)에서도 안전하게 불러 쓴다.

/** 후보의 근거가 된 자료(사용자가 고른 자료) */
export interface CandidateSource {
  id: string; // 이 요청 안에서의 번호
  title: string;
  citation: string; // 출처 한 줄
  sourceUrl: string; // 법제처 공개 링크
}

/** 후보를 이루는 문장 하나와, 그 근거가 된 원문 구절(원문에 글자 그대로 있는 것만 남는다) */
export interface CandidatePoint {
  text: string;
  quote: string;
  source: CandidateSource;
}

/** 판단 후보 하나. 결론이 아니라 검토할 수 있는 방향이다. */
export interface Candidate {
  title: string;
  reasons: CandidatePoint[]; // 이 후보를 뒷받침하는 근거
  counterpoints: CandidatePoint[]; // 이 후보와 엇갈리는 근거(숨기지 않고 함께 보여준다)
}

export interface CandidatesView {
  candidates: Candidate[];
  sources: CandidateSource[]; // 실제로 근거로 쓴 자료
  excluded: { title: string; reason: string }[]; // 근거로 쓸 수 없어 뺀 자료
  droppedCount: number; // 원문에서 근거를 확인하지 못해 뺀 문장 수
}

/** 한 번에 근거로 쓸 수 있는 자료 수 */
export const MAX_PICKS = 6;

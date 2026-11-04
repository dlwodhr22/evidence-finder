// 앱 전체에서 쓰는 데이터 모양.
// Design Ref: §6 데이터 모양 — 화면에 나오는 자료는 법제처에서 확인된 것(VerifiedItem)뿐이다.
// 판례·해석례·행정심판례는 PLAN 작업 7·8번에서 이 파일에 추가한다.

/** 법제처에서 확인된 법령 또는 자치법규 한 건 */
export interface LawItem {
  kind: "law";
  source: "law" | "ordin"; // law = 법률·시행령·시행규칙 등, ordin = 자치법규(조례·규칙)
  id: string; // 법제처 일련번호. 본문 조회와 공개 링크에 쓴다.
  title: string; // 법령명 또는 자치법규명
  lawType: string; // 법률, 대통령령, ○○부령, 조례, 규칙 등
  authority: string; // 소관부처 또는 지자체 이름
  isCurrent: boolean; // 현행 여부(PRD: 법령은 현행 여부를 반드시 표시)
  effectiveDate: string; // 시행일 YYYY-MM-DD(PRD: 법령은 시행일을 반드시 표시)
  sourceUrl: string; // 인증키 없이 열리는 법제처 공개 화면 주소
}

/** 화면에 올릴 수 있는 확인된 자료 */
export type VerifiedItem = LawItem;

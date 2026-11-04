// 화면(입력 양식·자료 목록)이 함께 쓰는 검색 상태의 모양.
// 서버 파일에서는 "모양(type)"만 가져온다. 모양은 화면 코드에 실제로 포함되지 않아 서버 비밀이 섞이지 않는다.
import type { SearchResponse } from "../lib/search";
import type { ClueVerification } from "../lib/verify";
import type { ReferenceLink } from "../lib/web-clues";

/** 법제처 직접 검색(/api/search) 상태 */
export type SearchState =
  | { status: "idle" }
  | { status: "loading"; piiNotice: string }
  | { status: "done"; piiNotice: string; data: SearchResponse }
  | { status: "error"; message: string };

/** 웹 단서 확인(/api/clues) 결과 */
export type CluesData = ClueVerification & { references: ReferenceLink[]; notices: string[] };

/** 웹 단서 확인(/api/clues) 상태 */
export type CluesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: CluesData }
  | { status: "error"; message: string };

export interface EvidenceState {
  search: SearchState;
  clues: CluesState;
}

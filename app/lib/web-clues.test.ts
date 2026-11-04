// 웹 단서 도구(web-clues.ts)와 검색 기록 모으기(ai.ts) 자동 시험. 실행: npm test
// 실제 웹검색 없이, 정리 규칙만 시험한다.
import { describe, expect, it } from "vitest";
import { collectWebSources } from "./ai";
import { isGovernmentUrl, sanitizeClues, sanitizeReferences } from "./web-clues";

const blank = { caseNumber: "", court: "", decisionDate: "", lawName: "", article: "" };

describe("단서 정리 — 검증에 필요한 칸이 없으면 버린다", () => {
  it("판례는 사건번호·법원·선고일이 모두 있어야 한다", () => {
    const clues = sanitizeClues([
      { ...blank, kind: "prec", caseNumber: "2024 두 31284", court: "대법원", decisionDate: "2024. 6. 27." },
      { ...blank, kind: "prec", caseNumber: "2023두42584", court: "대법원" }, // 선고일 없음
    ]);
    expect(clues).toEqual([
      { kind: "prec", caseNumber: "2024두31284", court: "대법원", decisionDate: "2024-06-27", lawName: "", article: "" },
    ]);
  });

  it("해석례·행정심판례는 번호와 날짜가 있어야 하고, 법원 칸은 비운다", () => {
    const clues = sanitizeClues([
      { ...blank, kind: "expc", caseNumber: "06-0007", court: "법제처", decisionDate: "2006.03.10" },
      { ...blank, kind: "decc", caseNumber: "2020경기행심2287" }, // 재결일 없음
    ]);
    expect(clues).toHaveLength(1);
    expect(clues[0]).toMatchObject({ kind: "expc", caseNumber: "06-0007", court: "", decisionDate: "2006-03-10" });
  });

  it('해석례 번호 앞에 붙은 기관 이름("법제처-")은 뗀다', () => {
    const [c] = sanitizeClues([{ ...blank, kind: "expc", caseNumber: "법제처-07-0367", decisionDate: "2007.12.07" }]);
    expect(c.caseNumber).toBe("07-0367");
  });

  it("헌재 결정의 법원은 헌법재판소로 맞춘다", () => {
    const [c] = sanitizeClues([{ ...blank, kind: "detc", caseNumber: "2021헌마918", court: "헌재", decisionDate: "2021-08-17" }]);
    expect(c.court).toBe("헌법재판소");
  });

  it("법령 조문은 법령명과 알아볼 수 있는 조문 번호가 있어야 한다", () => {
    const clues = sanitizeClues([
      { ...blank, kind: "law", lawName: "「국유재산법」", article: "제 72 조" },
      { ...blank, kind: "law", lawName: "국유재산법", article: "변상금 조항" },
    ]);
    expect(clues).toEqual([
      { kind: "law", caseNumber: "", court: "", decisionDate: "", lawName: "국유재산법", article: "제72조" },
    ]);
  });

  it("같은 단서는 한 번만", () => {
    const one = { ...blank, kind: "expc" as const, caseNumber: "06-0007", decisionDate: "2006-03-10" };
    expect(sanitizeClues([one, { ...one, caseNumber: "06 - 0007" }])).toHaveLength(1);
  });
});

describe("검색 기록에서 페이지 주소 모으기", () => {
  it("웹검색 기록(action.sources)과 인용 표시(url_citation)를 모두 모은다", () => {
    const sources = collectWebSources([
      { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://www.molit.go.kr/a" }] } },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            annotations: [{ type: "url_citation", url: "https://www.molit.go.kr/a", title: "국토부 질의회신" }],
          },
        ],
      },
      { type: "message", content: [{ type: "output_text", annotations: [{ type: "url_citation", url: "javascript:alert(1)" }] }] },
    ]);
    expect(sources).toEqual([{ url: "https://www.molit.go.kr/a", title: "국토부 질의회신" }]);
  });
});

describe("질의회신 링크 정리 — 실제로 검색된 정부 사이트만", () => {
  const sources = [
    { url: "https://www.molit.go.kr/qna/1", title: "국유지 무단점유 변상금 질의회신" },
    { url: "https://www.mois.go.kr/qna/2" }, // 제목 없음
    { url: "https://blog.example.com/post" },
    { url: "https://www.law.go.kr/precInfoP.do?precSeq=1" },
  ];

  it("검색 기록에 있는 정부 사이트 주소만 남기고, 제목은 검색 기록에서", () => {
    const refs = sanitizeReferences(
      [
        { url: "https://www.molit.go.kr/qna/1" },
        { url: "http://www.mois.go.kr/qna/2/" }, // http·끝의 / 차이는 같은 주소로 본다
        { url: "https://www.moef.go.kr/made-up" }, // 검색 기록에 없음 → 지어낸 링크
        { url: "https://blog.example.com/post" }, // 정부 사이트 아님
        { url: "https://www.law.go.kr/precInfoP.do?precSeq=1" }, // 법제처는 직접 조회로 다룸
      ],
      sources,
    );
    expect(refs).toEqual([
      { title: "국유지 무단점유 변상금 질의회신", url: "https://www.molit.go.kr/qna/1" },
      { title: "www.mois.go.kr 자료", url: "https://www.mois.go.kr/qna/2" },
    ]);
  });

  it("정부 사이트 판정", () => {
    expect(isGovernmentUrl("https://www.molit.go.kr/x")).toBe(true);
    expect(isGovernmentUrl("https://www.korea.kr/briefing")).toBe(true);
    expect(isGovernmentUrl("https://go.kr.example.com/x")).toBe(false);
    expect(isGovernmentUrl("not a url")).toBe(false);
  });
});

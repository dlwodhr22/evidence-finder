// 해석례·행정심판례 도구(rulings.ts) 자동 시험. 실행: npm test
// 법제처에 실제로 묻지 않고, 2026-11-04에 확인한 실제 응답 모양을 본떠 시험한다.
import { describe, expect, it } from "vitest";
import { isSameRuling, toInterpretationItem, toTribunalItem } from "./rulings";

describe("법령해석례 검색 결과 정리", () => {
  const expc = {
    법령해석례일련번호: "313010",
    안건번호: "06-0007",
    안건명: "「공유재산 및 물품 관리법」 제81조 및 「도로법」 제80조의2(변상금) 관련",
    회신기관명: "법제처",
    질의기관명: "서울특별시",
    회신일자: "2006.03.10",
  };

  it("공개 링크와 회신일이 채워진다", () => {
    expect(toInterpretationItem(expc)).toEqual({
      kind: "interpretation",
      id: "313010",
      title: "「공유재산 및 물품 관리법」 제81조 및 「도로법」 제80조의2(변상금) 관련",
      caseNumber: "06-0007",
      authority: "법제처",
      requester: "서울특별시",
      decisionDate: "2006-03-10",
      sourceUrl: "https://www.law.go.kr/expcInfoP.do?expcSeq=313010",
    });
  });

  it.each(["법령해석례일련번호", "안건번호", "회신일자"])("%s가 없으면 null", (key) => {
    expect(toInterpretationItem({ ...expc, [key]: "" })).toBeNull();
  });
});

describe("행정심판례 검색 결과 정리", () => {
  const decc = {
    행정심판재결례일련번호: "261093",
    사건번호: "2020경기행심2287",
    사건명: "공유수면법위반 변상금부과처분 취소청구",
    재결청: "경기도행정심판위원회",
    의결일자: "2021.05.17",
  };

  it("공개 링크와 재결일이 채워진다", () => {
    const item = toTribunalItem(decc);
    expect(item?.kind).toBe("tribunal");
    expect(item?.decisionDate).toBe("2021-05-17");
    expect(item?.authority).toBe("경기도행정심판위원회");
    expect(item?.sourceUrl).toBe("https://www.law.go.kr/deccInfoP.do?deccSeq=261093");
  });

  it.each(["행정심판재결례일련번호", "사건번호", "의결일자"])("%s가 없으면 null", (key) => {
    expect(toTribunalItem({ ...decc, [key]: "" })).toBeNull();
  });
});

describe("같은 자료인지 — 번호와 날짜가 모두 맞아야 한다", () => {
  const item = { caseNumber: "2020경기행심2287", decisionDate: "2021-05-17" };

  it("둘 다 같으면 같은 자료(표기 차이는 무시)", () => {
    expect(isSameRuling(item, { caseNumber: "2020 경기행심 2287", decisionDate: "2021. 5. 17." })).toBe(true);
  });

  it("하나라도 다르면 다른 자료", () => {
    expect(isSameRuling(item, { caseNumber: "2020경기행심2288", decisionDate: "2021-05-17" })).toBe(false);
    expect(isSameRuling(item, { caseNumber: "2020경기행심2287", decisionDate: "2021-05-18" })).toBe(false);
  });

  it("하나라도 없으면 확인된 것으로 보지 않는다", () => {
    expect(isSameRuling(item, { caseNumber: "2020경기행심2287" })).toBe(false);
    expect(isSameRuling(item, { decisionDate: "2021-05-17" })).toBe(false);
  });

  it("해석례 안건번호도 같은 방식", () => {
    expect(isSameRuling({ caseNumber: "06-0007", decisionDate: "2006-03-10" }, { caseNumber: "06-0007", decisionDate: "20060310" })).toBe(true);
  });
});

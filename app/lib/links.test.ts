// 링크 확인 도구(links.ts) 자동 시험. 실행: npm test
import { describe, expect, it } from "vitest";
import { isGovernmentLink, isLawGoKrUrl, siteName } from "./links";

describe("법제처 공개 주소", () => {
  it("키 없는 법제처 공개 주소만 통과", () => {
    expect(isLawGoKrUrl("https://www.law.go.kr/precInfoP.do?precSeq=242107")).toBe(true);
    expect(isLawGoKrUrl("https://www.law.go.kr/DRF/lawService.do?OC=abc&target=prec")).toBe(false);
    expect(isLawGoKrUrl("http://www.law.go.kr/precInfoP.do?precSeq=1")).toBe(false);
    expect(isLawGoKrUrl("https://law.go.kr.evil.com/x")).toBe(false);
    expect(isLawGoKrUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("정부 사이트 주소", () => {
  it.each([
    ["https://www.molit.go.kr/qna/1", true],
    ["http://www.suwon.go.kr/a", true],
    ["https://www.korea.kr/briefing", true],
    ["https://go.kr.example.com/x", false],
    ["javascript:alert(1)", false],
    ["ftp://www.molit.go.kr/x", false],
  ])("%s → %s", (url, expected) => {
    expect(isGovernmentLink(url)).toBe(expected);
  });

  it("사이트 이름", () => {
    expect(siteName("https://www.molit.go.kr/qna/1")).toBe("www.molit.go.kr");
    expect(siteName("잘못된 주소")).toBe("");
  });
});

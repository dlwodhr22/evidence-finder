// 검색 흐름(search.ts)의 정리 규칙 자동 시험. 실행: npm test
// AI·법제처를 실제로 부르지 않는 부분만 시험한다(실제 호출은 따로 확인).
import { describe, expect, it } from "vitest";
import { cleanTerms, dedupeById, fallbackTerms, matchesTerms, wantsOrdinances } from "./search";

describe("검색어 정리", () => {
  it("따옴표·괄호를 없애고 중복을 지운다", () => {
    expect(cleanTerms(["「국유재산법」", "국유재산법", " 변상금 ", "(무단점유)"], 5)).toEqual([
      "국유재산법",
      "변상금",
      "무단점유",
    ]);
  });

  it("빈 말과 너무 긴 말은 뺀다", () => {
    expect(cleanTerms(["", "   ", "가".repeat(31), "시효"], 5)).toEqual(["시효"]);
  });

  it("개수를 제한한다", () => {
    expect(cleanTerms(["가가", "나나", "다다", "라라"], 2)).toEqual(["가가", "나나"]);
  });
});

describe("AI를 쓸 수 없을 때 대신 쓰는 검색어", () => {
  it("관련 분야와 쟁점의 낱말에서 조사를 떼고 만든다", () => {
    const terms = fallbackTerms({
      facts: "사안",
      issue: "변상금 부과가 정당한지",
      field: "국유재산 관리",
    });
    expect(terms.source).toBe("fallback");
    expect(terms.lawNames).toEqual([]);
    expect(terms.keywords).toEqual(["국유재산", "관리", "변상금", "부과"]);
  });
});

describe("중복 지우기", () => {
  it("같은 번호는 처음 것만 남긴다", () => {
    expect(dedupeById([{ id: "1", n: "a" }, { id: "2", n: "b" }, { id: "1", n: "c" }])).toEqual([
      { id: "1", n: "a" },
      { id: "2", n: "b" },
    ]);
  });
});

describe("조례 검색 요청 판별(wantsOrdinances)", () => {
  const base = { facts: "국유지를 10년 넘게 써 온 민원인에게 변상금을 부과했습니다.", issue: "변상금 부과가 정당한지" };
  it("요청이 없으면 조례는 찾지 않는다(기본)", () => {
    expect(wantsOrdinances(base)).toBe(false);
    expect(wantsOrdinances({ ...base, facts: base.facts + " 시 조례에 따라 부과했습니다." })).toBe(false);
  });
  it("조례(자치법규)를 찾아 달라는 요청이 있으면 찾는다", () => {
    expect(wantsOrdinances({ ...base, issue: base.issue + " 조례까지 검색해줘" })).toBe(true);
    expect(wantsOrdinances({ ...base, issue: "조례도 찾아줘" })).toBe(true);
    expect(wantsOrdinances({ ...base, facts: base.facts + "\n자치법규 포함해서 확인해 주세요." })).toBe(true);
    expect(wantsOrdinances({ ...base, issue: "관련 조례를 검색해 주세요" })).toBe(true);
  });
});

describe("관련성 거름망(matchesTerms)", () => {
  const terms = { lawNames: ["국유재산법"], keywords: ["변상금", "무단점유"] };
  it("제목에 법령명이나 검색어가 있으면 남긴다(띄어쓰기·가운뎃점 차이 무시)", () => {
    expect(matchesTerms("국유재산법 시행령", terms)).toBe(true);
    expect(matchesTerms("변상금부과처분취소", terms)).toBe(true);
    expect(matchesTerms("순천시 도로점용료ㆍ변상금 및 과태료 부과징수 조례", terms)).toBe(true);
    expect(matchesTerms("무단 점유", { lawNames: [], keywords: ["무단점유"] })).toBe(true);
  });
  it("제목에 없으면 거른다", () => {
    expect(matchesTerms("가평군 건축 조례", terms)).toBe(false);
    expect(matchesTerms("취득세 등 부과 처분 무효 확인 등", terms)).toBe(false);
  });
  it("한 글자짜리 검색어로는 맞추지 않는다", () => {
    expect(matchesTerms("가평군 건축 조례", { lawNames: [], keywords: ["가"] })).toBe(false);
  });
});

describe("일반 행정 용어 제외(cleanTerms)", () => {
  it("민원·사안 같은 어느 사안에나 나오는 말은 검색어로 쓰지 않는다", () => {
    expect(cleanTerms(["민원", "변상금", "민원인", "사안", "무단점유", "민원 처리"], 4)).toEqual(["변상금", "무단점유"]);
  });
});

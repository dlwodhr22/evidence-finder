// 검색 흐름(search.ts)의 정리 규칙 자동 시험. 실행: npm test
// AI·법제처를 실제로 부르지 않는 부분만 시험한다(실제 호출은 따로 확인).
import { describe, expect, it } from "vitest";
import { cleanTerms, dedupeById, fallbackTerms, preferLocalGov } from "./search";
import type { LawItem } from "./types";

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
      localGov: "",
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

describe("관련 지자체 조례를 앞으로", () => {
  const make = (id: string, title: string, authority: string): LawItem => ({
    kind: "law",
    source: "ordin",
    id,
    title,
    lawType: "조례",
    authority,
    isCurrent: true,
    notYetEffective: false,
    effectiveDate: "2026-01-01",
    sourceUrl: "",
  });
  const items = [
    make("1", "가평군 공유재산 관리 조례", "경기도 가평군"),
    make("2", "순천시 공유재산 관리 조례", "전남광주통합특별시 순천시"),
    make("3", "강릉시 공유재산 관리 조례", "강원특별자치도 강릉시"),
  ];

  it("적은 지자체가 앞에 온다(나머지 순서는 유지)", () => {
    expect(preferLocalGov(items, "순천시").map((i) => i.id)).toEqual(["2", "1", "3"]);
  });

  it("비워 두면 그대로", () => {
    expect(preferLocalGov(items, "").map((i) => i.id)).toEqual(["1", "2", "3"]);
  });
});

// 결과 합치기(results.ts)와 법령 이름 비교(verify.ts) 자동 시험. 실행: npm test
import { describe, expect, it } from "vitest";
import { mergeVerified, resultKey, type SearchResults } from "./results";
import type { CaseItem, LawItem, TribunalItem } from "./types";
import { normalizeLawName } from "./verify";

const law = (id: string, extra: Partial<LawItem> = {}): LawItem => ({
  kind: "law",
  source: "law",
  id,
  title: `법령${id}`,
  lawType: "법률",
  authority: "",
  isCurrent: true,
  notYetEffective: false,
  effectiveDate: "2026-01-01",
  sourceUrl: "",
  ...extra,
});
const prec = (id: string): CaseItem => ({
  kind: "case",
  source: "prec",
  id,
  title: `판례${id}`,
  caseNumber: id,
  court: "대법원",
  decisionDate: "2024-01-01",
  decisionType: "판결",
  sourceUrl: "",
});
const decc = (id: string): TribunalItem => ({
  kind: "tribunal",
  id,
  title: `심판${id}`,
  caseNumber: id,
  authority: "",
  decisionDate: "2024-01-01",
  sourceUrl: "",
});

const empty: SearchResults = { statutes: [], ordinances: [], cases: [], interpretations: [], tribunals: [] };

describe("웹 단서로 확인된 자료 합치기", () => {
  it("같은 종류 목록의 앞에 넣고, 같은 자료는 한 번만", () => {
    const merged = mergeVerified({ ...empty, cases: [prec("A"), prec("B")] }, [prec("B"), prec("C")]);
    expect(merged.cases.map((c) => c.id)).toEqual(["B", "C", "A"]);
  });

  it("종류에 맞는 목록으로 들어간다(조례는 조례 목록으로)", () => {
    const merged = mergeVerified(empty, [law("1"), law("2", { source: "ordin" }), decc("D")]);
    expect(merged.statutes.map((l) => l.id)).toEqual(["1"]);
    expect(merged.ordinances.map((l) => l.id)).toEqual(["2"]);
    expect(merged.tribunals.map((t) => t.id)).toEqual(["D"]);
  });

  it("같은 법령이라도 조문이 다르면 따로 둔다", () => {
    const merged = mergeVerified({ ...empty, statutes: [law("1")] }, [law("1", { article: "제72조" })]);
    expect(merged.statutes).toHaveLength(2);
    expect(resultKey(merged.statutes[0])).toBe("law:law:1:제72조");
  });

  it("최대 건수를 넘지 않는다", () => {
    const merged = mergeVerified({ ...empty, cases: [prec("1"), prec("2"), prec("3")] }, [prec("4"), prec("5")], 3);
    expect(merged.cases.map((c) => c.id)).toEqual(["4", "5", "1"]);
  });

  it("법원 판례와 헌재 결정은 번호가 같아도 다른 자료", () => {
    const detc: CaseItem = { ...prec("X"), source: "detc" };
    expect(mergeVerified({ ...empty, cases: [prec("X")] }, [detc]).cases).toHaveLength(2);
  });
});

describe("법령 이름 비교", () => {
  it("띄어쓰기·가운뎃점·낫표 차이를 무시한다", () => {
    expect(normalizeLawName("「공유재산 및 물품 관리법」")).toBe(normalizeLawName("공유재산및물품관리법"));
    expect(normalizeLawName("도로점용료ㆍ변상금")).toBe(normalizeLawName("도로점용료·변상금"));
  });
});

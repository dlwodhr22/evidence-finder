// 법령·자치법규 도구(laws.ts)의 정리 규칙 자동 시험. 실행: npm test
// 법제처에 실제로 묻지 않고, 2026-11-04에 확인한 실제 응답 모양을 본떠 시험한다.
import { describe, expect, it } from "vitest";
import {
  articleLabel,
  buildStatuteArticleText,
  findArticle,
  formatLawDate,
  parseArticleEffectiveDates,
  parseArticleLabel,
  parseOrdinanceArticleNo,
  todayInKorea,
  toOrdinanceItem,
  toStatuteItem,
  type LawDocument,
} from "./laws";

describe("날짜", () => {
  it("법제처 날짜를 YYYY-MM-DD로 바꾼다", () => {
    expect(formatLawDate("20260820")).toBe("2026-08-20");
    expect(formatLawDate("2024.06.27")).toBe("2024-06-27");
    expect(formatLawDate("")).toBe("");
    expect(formatLawDate("2026")).toBe("");
  });

  it("오늘 날짜는 한국 시간 기준", () => {
    // 2026-11-04 16:00 UTC = 2026-11-05 01:00 KST
    expect(todayInKorea(new Date("2026-11-04T16:00:00Z"))).toBe("2026-11-05");
  });
});

describe("조문 번호", () => {
  it.each([
    ["제72조", 72, 0],
    ["72조", 72, 0],
    ["제8조의2", 8, 2],
    ["제 8 조 의 2", 8, 2],
  ])("%s", (label, number, branch) => {
    expect(parseArticleLabel(label)).toEqual({ number, branch });
  });

  it("알아볼 수 없는 번호는 null", () => {
    expect(parseArticleLabel("제72항")).toBeNull();
    expect(parseArticleLabel("변상금")).toBeNull();
  });

  it("번호 표시", () => {
    expect(articleLabel(72, 0)).toBe("제72조");
    expect(articleLabel(8, 2)).toBe("제8조의2");
  });

  it("자치법규 조문번호 000602 → 제6조의2", () => {
    expect(parseOrdinanceArticleNo(["000602", "000602"])).toEqual({ number: 6, branch: 2 });
    expect(parseOrdinanceArticleNo("000100")).toEqual({ number: 1, branch: 0 });
    expect(parseOrdinanceArticleNo("12")).toBeNull();
  });
});

describe("조문별 시행일(시행 예정 찾기)", () => {
  // 국유재산법 실제 값(2026-11-04 확인). 날짜와 다음 날짜가 붙어 있다: "…제73조의220270820:…"
  const raw =
    "20260219:제18조제1항제5호, 제35조제2항, 제46조제2항, 제73조제2항, 제73조의220270820:제73조의4";

  it("날짜별로 나누고, 조문 전체인지 일부인지 구분한다", () => {
    expect(parseArticleEffectiveDates(raw)).toEqual([
      { date: "2026-02-19", number: 18, branch: 0, part: "제18조제1항제5호", whole: false },
      { date: "2026-02-19", number: 35, branch: 0, part: "제35조제2항", whole: false },
      { date: "2026-02-19", number: 46, branch: 0, part: "제46조제2항", whole: false },
      { date: "2026-02-19", number: 73, branch: 0, part: "제73조제2항", whole: false },
      { date: "2026-02-19", number: 73, branch: 2, part: "제73조의2", whole: true },
      { date: "2027-08-20", number: 73, branch: 4, part: "제73조의4", whole: true },
    ]);
  });

  it("빈 값이면 빈 목록", () => {
    expect(parseArticleEffectiveDates("")).toEqual([]);
  });
});

describe("조문 글 합치기", () => {
  it("항·호·목을 순서대로 원문 그대로 합친다", () => {
    const unit = {
      조문내용: "제72조(변상금의 징수)",
      항: [
        {
          항내용: "① 변상금을 징수한다. 다만, 다음 각 호의 경우에는 징수하지 아니한다.",
          호: [{ 호내용: "1. 첫째 경우", 목: [{ 목내용: "가. 세부 사항" }] }, { 호내용: "2. 둘째 경우" }],
        },
        { 항내용: "② 나누어 내게 할 수 있다." },
      ],
    };
    expect(buildStatuteArticleText(unit)).toBe(
      [
        "제72조(변상금의 징수)",
        "① 변상금을 징수한다. 다만, 다음 각 호의 경우에는 징수하지 아니한다.",
        "1. 첫째 경우",
        "가. 세부 사항",
        "2. 둘째 경우",
        "② 나누어 내게 할 수 있다.",
      ].join("\n"),
    );
  });

  it("항이 하나면 목록이 아니라 낱개로 와도 처리한다", () => {
    expect(buildStatuteArticleText({ 조문내용: "제2조(정의)", 항: { 항내용: "① 정의한다." } })).toBe(
      "제2조(정의)\n① 정의한다.",
    );
  });

  it("항이 없으면 조문내용만", () => {
    expect(buildStatuteArticleText({ 조문내용: "제1조(목적) 이 법은 …을 목적으로 한다." })).toBe(
      "제1조(목적) 이 법은 …을 목적으로 한다.",
    );
  });
});

describe("검색 결과 정리 — 필수 정보가 빠지면 내보내지 않는다", () => {
  const statute = {
    법령일련번호: "283349",
    법령명한글: "국유재산법",
    법령구분명: "법률",
    소관부처명: "재정경제부",
    현행연혁코드: "현행",
    시행일자: "20260820",
  };

  it("법령: 현행 여부·시행일·키 없는 공개 링크가 채워진다", () => {
    expect(toStatuteItem(statute)).toEqual({
      kind: "law",
      source: "law",
      id: "283349",
      title: "국유재산법",
      lawType: "법률",
      authority: "재정경제부",
      isCurrent: true,
      notYetEffective: false,
      effectiveDate: "2026-08-20",
      sourceUrl: "https://www.law.go.kr/lsInfoP.do?lsiSeq=283349",
    });
  });

  it("법령: 연혁(현행 아님)은 isCurrent=false", () => {
    expect(toStatuteItem({ ...statute, 현행연혁코드: "연혁" })?.isCurrent).toBe(false);
  });

  it.each(["법령일련번호", "법령명한글", "시행일자", "현행연혁코드"])("법령: %s가 없으면 null", (key) => {
    expect(toStatuteItem({ ...statute, [key]: "" })).toBeNull();
  });

  const ordinance = {
    자치법규일련번호: "1309383",
    자치법규명: "순천시 도로점용료·변상금 및 과태료 부과징수 조례",
    자치법규종류: "조례",
    지자체기관명: "전남광주통합특별시 순천시",
    시행일자: "20171030",
    제개정구분명: "일부개정",
  };

  it("자치법규: 공개 링크와 시행일이 채워진다", () => {
    const item = toOrdinanceItem(ordinance);
    expect(item?.sourceUrl).toBe("https://www.law.go.kr/ordinInfoP.do?ordinSeq=1309383");
    expect(item?.effectiveDate).toBe("2017-10-30");
    expect(item?.isCurrent).toBe(true);
  });

  it("자치법규: 폐지되었으면 isCurrent=false", () => {
    expect(toOrdinanceItem({ ...ordinance, 제개정구분명: "폐지" })?.isCurrent).toBe(false);
  });

  it("자치법규: 시행일이 없으면 null", () => {
    expect(toOrdinanceItem({ ...ordinance, 시행일자: "" })).toBeNull();
  });

  // 2026-11-05 화면 확인: 현행 목록에 있는 강릉시 조례의 시행일이 2027-01-01이었다.
  it("시행일이 오늘보다 뒤면 시행 예정으로 표시한다", () => {
    expect(toOrdinanceItem({ ...ordinance, 시행일자: "20270101" }, "2026-11-05")?.notYetEffective).toBe(true);
    expect(toStatuteItem({ ...statute, 시행일자: "20270820" }, "2026-11-05")?.notYetEffective).toBe(true);
    expect(toOrdinanceItem({ ...ordinance, 시행일자: "20261105" }, "2026-11-05")?.notYetEffective).toBe(false);
  });
});

describe("조문 찾기 — 현행 본문에 없는 조문은 찾지 못한다", () => {
  const doc: LawDocument = {
    source: "law",
    id: "1",
    title: "시험법",
    lawType: "법률",
    authority: "",
    effectiveDate: "2026-01-01",
    sourceUrl: "",
    articles: [
      { label: "제8조", number: 8, branch: 0, title: "", text: "제8조", effectiveDate: "", notYetEffective: false, pendingParts: [] },
      { label: "제8조의2", number: 8, branch: 2, title: "", text: "제8조의2", effectiveDate: "", notYetEffective: false, pendingParts: [] },
    ],
  };

  it("가지번호까지 정확히 찾는다", () => {
    expect(findArticle(doc, "제8조의2")?.label).toBe("제8조의2");
    expect(findArticle(doc, "제8조")?.label).toBe("제8조");
  });

  it("없는 조문은 undefined", () => {
    expect(findArticle(doc, "제8조의3")).toBeUndefined();
    expect(findArticle(doc, "제99조")).toBeUndefined();
  });
});

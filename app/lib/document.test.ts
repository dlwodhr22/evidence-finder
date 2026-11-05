// 원문 확인(document.ts)의 입력 검사와 요약 검증 자동 시험. 실행: npm test
// AI나 법제처에 실제로 묻지 않고 규칙만 시험한다.
import { describe, expect, it } from "vitest";
import { groundSummary, MAX_SUMMARY_CHARS, parseDocumentRef, summarySourceText } from "./document";
import { refOf } from "./document-types";
import type { LawItem } from "./types";

describe("원문 요청 검사", () => {
  it("올바른 요청은 통과한다", () => {
    expect(parseDocumentRef({ kind: "law", source: "law", id: "283349", article: "제72조" })).toEqual({
      kind: "law",
      source: "law",
      id: "283349",
      article: "제72조",
    });
    expect(parseDocumentRef({ kind: "case", source: "prec", id: "1" })).toEqual({ kind: "case", source: "prec", id: "1" });
    expect(parseDocumentRef({ kind: "tribunal", id: "55" })).toEqual({ kind: "tribunal", id: "55" });
  });

  it.each([
    [{ kind: "law", source: "law", id: "abc" }],
    [{ kind: "law", source: "prec", id: "1" }],
    [{ kind: "case", source: "law", id: "1" }],
    [{ kind: "law", source: "law", id: "1", article: "변상금" }],
    [{ kind: "x", id: "1" }],
    [{ kind: "tribunal", id: "" }],
    [{ kind: "tribunal", id: "1; DROP" }],
  ])("잘못된 요청은 거절한다 %j", (params) => {
    expect(parseDocumentRef(params)).toBeNull();
  });
});

describe("목록 항목 → 원문 요청", () => {
  const law: LawItem = {
    kind: "law",
    source: "ordin",
    id: "9",
    title: "시험 조례",
    lawType: "조례",
    authority: "",
    isCurrent: true,
    notYetEffective: false,
    effectiveDate: "2026-01-01",
    sourceUrl: "",
    article: "제6조의2",
  };
  it("법령은 조문까지 담는다", () => {
    expect(refOf(law)).toEqual({ kind: "law", source: "ordin", id: "9", article: "제6조의2" });
  });
});

describe("AI 요약 검증 — 원문에 없는 구절을 근거로 댄 문장은 뺀다", () => {
  const source = "제72조(변상금의 징수) ① 점용허가 없이 국유재산을 사용한 자에게 변상금을 징수한다.";

  it("근거 구절이 원문에 그대로 있으면 남긴다(줄바꿈·띄어쓰기 차이는 무시)", () => {
    const result = groundSummary(
      [{ text: "허가 없이 쓰면 변상금을 낸다.", quote: "점용허가 없이  국유재산을 사용한 자에게 변상금을 징수한다" }],
      source,
    );
    expect(result.sentences).toHaveLength(1);
    expect(result.droppedCount).toBe(0);
  });

  it("원문에 없는 구절, 너무 짧은 구절은 뺀다", () => {
    const result = groundSummary(
      [
        { text: "지어낸 문장", quote: "무단점유자는 반드시 형사처벌을 받는다" },
        { text: "짧은 근거", quote: "변상금" },
        { text: "", quote: "점용허가 없이 국유재산을 사용한 자에게" },
      ],
      source,
    );
    expect(result.sentences).toHaveLength(0);
    expect(result.droppedCount).toBe(2); // 빈 문장은 세지 않고 버린다
  });
});

describe("요약에 쓰는 원문 범위", () => {
  it("한도보다 길면 앞부분만 쓴다", () => {
    const long = "가".repeat(MAX_SUMMARY_CHARS + 500);
    expect(summarySourceText(long)).toHaveLength(MAX_SUMMARY_CHARS);
    expect(summarySourceText("짧은 글")).toBe("짧은 글");
  });

  it("판결문은 청구취지·주문을 건너뛰고 이유부터 쓴다(판시사항은 유지)", () => {
    const text = "【판시사항】\n판시 내용\n\n【판례내용】\n【원고】 갑\n【청구취지】 변상금 부과처분을 취소한다\n\n이 유\n\n1. 법원의 판단 내용";
    const src = summarySourceText(text);
    expect(src).toContain("판시 내용");
    expect(src).toContain("법원의 판단 내용");
    expect(src).not.toContain("청구취지");
  });

  it("【이 유】 괄호 제목도 인식한다", () => {
    const src = summarySourceText("【판례내용】\n【주 문】 상고를 기각한다 【이 유】 상고이유를 판단한다");
    expect(src).toContain("상고이유를 판단한다");
    expect(src).not.toContain("상고를 기각한다");
  });

  it("이유 제목이 없으면 원문을 그대로 쓴다", () => {
    const text = "【판례내용】\n【청구취지】 내용";
    expect(summarySourceText(text)).toBe(text);
  });

  it("범위 밖(잘린 뒷부분)에서 가져온 구절은 확인되지 않는다", () => {
    const long = "가".repeat(MAX_SUMMARY_CHARS) + "뒷부분에만 있는 구절입니다";
    const result = groundSummary([{ text: "뒷부분 요약", quote: "뒷부분에만 있는 구절입니다" }], summarySourceText(long));
    expect(result.sentences).toHaveLength(0);
  });
});

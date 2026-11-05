// 복사 글 만들기(copy-text.ts) 자동 시험. 실행: npm test
import { describe, expect, it } from "vitest";
import { buildSourceAndOriginalText, buildSourceText } from "./copy-text";
import type { DocumentView } from "./document-types";

const doc: DocumentView = {
  title: "국유재산법",
  citation: "법률 · 재정경제부 · 제72조(변상금의 징수)",
  sourceUrl: "https://www.law.go.kr/lsInfoP.do?lsiSeq=283349",
  sections: [{ heading: "제72조", text: "제72조(변상금의 징수)\n① 변상금을 징수한다." }],
  warnings: [],
};

describe("복사 글", () => {
  it("출처만: 제목·출처 한 줄·법제처 링크", () => {
    expect(buildSourceText("국유재산법", doc)).toBe(
      "국유재산법\n법률 · 재정경제부 · 제72조(변상금의 징수)\n출처: 법제처 https://www.law.go.kr/lsInfoP.do?lsiSeq=283349",
    );
  });

  it("출처와 원문: 원문이 한 부분이면 제목 없이 그대로 붙인다", () => {
    const text = buildSourceAndOriginalText("국유재산법", doc);
    expect(text.endsWith("[법제처 원문]\n제72조(변상금의 징수)\n① 변상금을 징수한다.")).toBe(true);
  });

  it("원문이 여러 부분이면 부분 제목을 붙이고, AI 요약은 넣지 않는다", () => {
    const text = buildSourceAndOriginalText("판례", {
      ...doc,
      sections: [
        { heading: "판시사항", text: "가" },
        { heading: "판결요지", text: "나" },
      ],
    });
    expect(text).toContain("【판시사항】\n가\n\n【판결요지】\n나");
    expect(text).not.toContain("AI 요약");
  });
});

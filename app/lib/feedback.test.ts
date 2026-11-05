// 잘못된 결과 신고(feedback.ts)의 요청 검사 자동 시험. 실행: npm test
// 법제처에 실제로 묻는 부분은 시험하지 않고(화면에서 확인), 받는 값의 모양만 시험한다.
import { describe, expect, it } from "vitest";
import { feedbackRequestSchema } from "./feedback";

const prec = {
  kind: "case",
  source: "prec",
  id: "1234",
  title: "변상금부과처분취소",
  caseNumber: "97누4098",
  court: "대법원",
  decisionDate: "2000-01-28",
  decisionType: "판결",
  sourceUrl: "https://www.law.go.kr/precInfoP.do?precSeq=1234",
};

describe("신고 요청 검사", () => {
  it("올바른 신고는 통과한다", () => {
    expect(feedbackRequestSchema.safeParse({ reason: "wrong", item: prec }).success).toBe(true);
    expect(feedbackRequestSchema.safeParse({ reason: "summary", item: prec, article: "제72조" }).success).toBe(true);
  });

  it("정해진 이유 세 가지 밖의 이유(관련 없음 등)는 거절한다", () => {
    expect(feedbackRequestSchema.safeParse({ reason: "irrelevant", item: prec }).success).toBe(false);
    expect(feedbackRequestSchema.safeParse({ item: prec }).success).toBe(false);
  });

  it("직접 입력한 글(추가 칸)은 받지 않는다", () => {
    const parsed = feedbackRequestSchema.safeParse({ reason: "wrong", item: prec, memo: "개인 메모" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "memo" in parsed.data).toBe(false);
  });

  it("번호가 숫자가 아니거나 종류를 알 수 없는 항목은 거절한다", () => {
    expect(feedbackRequestSchema.safeParse({ reason: "wrong", item: { ...prec, id: "12; DROP" } }).success).toBe(false);
    expect(feedbackRequestSchema.safeParse({ reason: "wrong", item: { ...prec, kind: "x" } }).success).toBe(false);
  });
});

// 회신 초안(draft.ts)의 근거 검증과 복사 글 자동 시험. 실행: npm test
// AI나 법제처에 실제로 묻지 않고 규칙만 시험한다.
import { describe, expect, it } from "vitest";
import { buildDraftText } from "./copy-text";
import { draftRequestSchema, groundDraft } from "./draft";
import { CASE_SOURCE_ID, DRAFT_NOTICE } from "./draft-types";
import type { CandidateSource } from "./candidate-types";

const mk = (id: string, title: string): CandidateSource => ({ id, title, citation: "법률 · 제72조", sourceUrl: `https://www.law.go.kr/x/${id}` });
const sources = { s1: mk("s1", "국유재산법"), [CASE_SOURCE_ID]: mk(CASE_SOURCE_ID, "입력한 사안") };
const texts = {
  s1: "중앙관서의 장등은 무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다.",
  [CASE_SOURCE_ID]: "민원인이 국유지 도로 부지를 10년 넘게 창고 앞마당으로 사용했습니다.\n변상금 부과가 정당한지",
};
const sent = (text: string, quote: string, sourceId: string) => ({ text, quote, sourceId });

describe("회신 초안 근거 검증", () => {
  const good = {
    title: "변상금 부과 이의 신청에 대한 회신",
    background: [sent("민원인이 국유지를 장기간 사용하였습니다.", "국유지 도로 부지를 10년 넘게 창고 앞마당으로 사용했습니다", CASE_SOURCE_ID)],
    review: [sent("무단점유자에게는 변상금을 징수합니다.", "무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다", "s1")],
    reply: [sent("변상금 부과는 적법한 것으로 판단됩니다.", "무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다", "s1")],
  };

  it("근거가 확인된 문장으로 초안을 만들고 쓴 자료를 모은다", () => {
    const draft = groundDraft(good, texts, sources);
    expect(draft?.review).toHaveLength(1);
    expect(draft?.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(draft?.droppedCount).toBe(0);
  });

  it("원문에 없는 구절을 근거로 댄 문장은 뺀다", () => {
    const draft = groundDraft({ ...good, review: [...good.review, sent("지어낸 문장", "원문에 전혀 없는 구절을 지어내어 적었습니다", "s1")] }, texts, sources);
    expect(draft?.review).toHaveLength(1);
    expect(draft?.droppedCount).toBe(1);
  });

  it("경위에 법령 원문을 근거로 대거나, 검토 결과에 사안을 근거로 대면 인정하지 않는다", () => {
    const draft = groundDraft(
      {
        ...good,
        background: [sent("법령 내용을 경위에", "무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다", "s1")],
        review: [...good.review, sent("사안을 검토 결과에", "국유지 도로 부지를 10년 넘게 창고 앞마당으로 사용했습니다", CASE_SOURCE_ID)],
      },
      texts,
      sources,
    );
    expect(draft?.background).toHaveLength(0);
    expect(draft?.review).toHaveLength(1);
    expect(draft?.droppedCount).toBe(2);
  });

  it("검토 결과나 회신 내용이 비면 초안을 만들지 않는다", () => {
    expect(groundDraft({ ...good, review: [] }, texts, sources)).toBeNull();
    expect(groundDraft({ ...good, reply: [sent("x", "없는 구절을 근거로 댄 문장입니다 정말로", "s1")] }, texts, sources)).toBeNull();
  });
});

describe("복사 글", () => {
  it("초안 표시, 제목, 경위·검토 결과·회신 내용, 붙임 근거가 들어간다", () => {
    const draft = groundDraft(
      {
        title: "회신",
        background: [sent("경위 문장입니다.", "국유지 도로 부지를 10년 넘게 창고 앞마당으로 사용했습니다", CASE_SOURCE_ID)],
        review: [sent("검토 문장입니다.", "무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다", "s1")],
        reply: [sent("회신 문장입니다.", "무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다", "s1")],
      },
      texts,
      sources,
    )!;
    const text = buildDraftText(draft);
    expect(text.startsWith(`※ ${DRAFT_NOTICE}`)).toBe(true);
    expect(text).toContain("제목: 회신");
    expect(text).toContain("1. 경위\n- 경위 문장입니다.\n");
    expect(text).toContain("- 검토 문장입니다. [근거 1]");
    expect(text).toContain("붙임(근거 자료)\n1. 국유재산법");
    expect(text).not.toContain("입력한 사안 ("); // 사안은 붙임 근거에 넣지 않는다
  });
});

describe("초안 요청 검사", () => {
  it("판단 후보가 없으면 거절한다", () => {
    const input = { facts: "가".repeat(30), issue: "나".repeat(10), field: "", localGov: "" };
    const picks = [{ kind: "case", source: "prec", id: "1" }];
    expect(draftRequestSchema.safeParse({ input, picks }).success).toBe(false);
    expect(draftRequestSchema.safeParse({ input, picks, candidate: { title: "후보", reasons: [], counterpoints: [] } }).success).toBe(true);
  });
});

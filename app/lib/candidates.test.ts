// 판단 후보(candidates.ts)의 요청 검사와 근거 검증 자동 시험. 실행: npm test
// AI나 법제처에 실제로 묻지 않고 규칙만 시험한다.
import { describe, expect, it } from "vitest";
import { groundCandidates, parsePicks } from "./candidates";
import type { CandidateSource } from "./candidate-types";

describe("고른 자료 검사", () => {
  it("올바른 자료는 통과하고 같은 자료는 한 번만 담는다", () => {
    const picks = parsePicks([
      { kind: "law", source: "law", id: "1", article: "제72조" },
      { kind: "law", source: "law", id: "1", article: "제72조" },
      { kind: "case", source: "prec", id: "2" },
    ]);
    expect(picks).toHaveLength(2);
  });

  it("조문 없는 법령, 알 수 없는 자료가 섞이면 거절한다", () => {
    expect(parsePicks([{ kind: "law", source: "law", id: "1" }])).toBeNull();
    expect(parsePicks([{ kind: "x", id: "1" }])).toBeNull();
    expect(parsePicks([{ kind: "case", source: "prec", id: "abc" }])).toBeNull();
  });
});

describe("판단 후보 근거 검증", () => {
  const texts = {
    s1: "제72조(변상금의 징수) ① 중앙관서의 장등은 무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다.",
    s2: "국유재산의 무단점유에 대한 변상금징수는 처분청의 재량을 허용하지 않는 기속행위이다.",
  };
  const mk = (id: string): CandidateSource => ({ id, title: `자료${id}`, citation: "", sourceUrl: "" });
  const sources = { s1: mk("s1"), s2: mk("s2") };

  it("근거 구절이 원문에 있는 문장만 남기고 출처를 붙인다", () => {
    const { candidates, droppedCount } = groundCandidates(
      [
        {
          title: "변상금을 부과해야 할 여지가 있음",
          reasons: [
            { text: "무단점유자에게 변상금을 징수한다.", quote: "무단점유자에 대하여 사용료의 100분의 120에 상당하는 변상금을 징수한다", sourceId: "s1" },
            { text: "지어낸 문장", quote: "없는 구절을 그럴듯하게 만들어 낸 것입니다", sourceId: "s1" },
          ],
          counterpoints: [{ text: "재량이 없다.", quote: "처분청의 재량을 허용하지 않는 기속행위이다", sourceId: "s2" }],
        },
      ],
      texts,
      sources,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons).toHaveLength(1);
    expect(candidates[0].reasons[0].source.id).toBe("s1");
    expect(candidates[0].counterpoints[0].source.id).toBe("s2");
    expect(droppedCount).toBe(1);
  });

  it("근거 구절을 다른 자료 번호로 대면 인정하지 않는다", () => {
    const { candidates } = groundCandidates(
      [
        {
          title: "후보",
          reasons: [{ text: "문장", quote: "처분청의 재량을 허용하지 않는 기속행위이다", sourceId: "s1" }],
          counterpoints: [],
        },
      ],
      texts,
      sources,
    );
    expect(candidates).toHaveLength(0);
  });

  it("뒷받침 근거가 하나도 없는 후보는 통째로 뺀다", () => {
    const { candidates, droppedCount } = groundCandidates(
      [{ title: "후보", reasons: [], counterpoints: [{ text: "반대", quote: "처분청의 재량을 허용하지 않는 기속행위이다", sourceId: "s2" }] }],
      texts,
      sources,
    );
    expect(candidates).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });
});

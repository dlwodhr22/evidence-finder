import { describe, expect, it } from "vitest";
import { candidateExcerpt, candidateKey, verifyPicks } from "./case-relevance";

describe("후보 판례의 발췌문", () => {
  it("판시사항·판결요지만 뽑고 다른 칸(판례내용 등)은 쓰지 않는다", () => {
    const text = candidateExcerpt({
      sections: [
        { heading: "판시사항", text: "건물 부지에 해당하는지 여부" },
        { heading: "참조조문", text: "국유재산법 제72조" },
        { heading: "판례내용", text: "청구취지 ..." },
      ],
    });
    expect(text).toContain("【판시사항】 건물 부지에 해당하는지 여부");
    expect(text).not.toContain("참조조문");
    expect(text).not.toContain("청구취지");
  });

  it("뽑을 칸이 없으면 빈 글(판단할 수 없는 후보)", () => {
    expect(candidateExcerpt({ sections: [{ heading: "판례내용", text: "내용" }] })).toBe("");
  });

  it("법원 판례와 헌재 결정은 번호가 같아도 구분한다", () => {
    expect(candidateKey({ source: "prec", id: "1" })).not.toBe(candidateKey({ source: "detc", id: "1" }));
  });
});

describe("AI가 고른 판례 확인", () => {
  const excerpts = {
    "prec:1": "【판시사항】 변상금 부과 대상인 건물 부지에 해당하는지 판단하는 기준",
    "prec:2": "【판시사항】 다른 내용의 판시사항입니다 충분히 긴 문장",
  };

  it("근거 구절이 그 판례에 글자 그대로 있는 것만 남긴다", () => {
    const keys = verifyPicks(
      [{ key: "prec:1", quote: "건물 부지에 해당하는지 판단하는 기준", reason: "관련" }],
      excerpts,
      5,
    );
    expect(keys).toEqual(["prec:1"]);
  });

  it("지어낸 자료 번호나 원문에 없는 구절은 버린다", () => {
    const keys = verifyPicks(
      [
        { key: "prec:999", quote: "건물 부지에 해당하는지 판단하는 기준", reason: "없는 판례" },
        { key: "prec:2", quote: "건물 부지에 해당하는지 판단하는 기준", reason: "다른 판례의 구절" },
        { key: "prec:1", quote: "원문에 없는 지어낸 구절입니다", reason: "지어냄" },
      ],
      excerpts,
      5,
    );
    expect(keys).toEqual([]);
  });

  it("같은 판례는 한 번만, 최대 건수까지만 남긴다", () => {
    const keys = verifyPicks(
      [
        { key: "prec:1", quote: "건물 부지에 해당하는지 판단하는 기준", reason: "a" },
        { key: "prec:1", quote: "변상금 부과 대상인 건물 부지", reason: "b" },
        { key: "prec:2", quote: "다른 내용의 판시사항입니다", reason: "c" },
      ],
      excerpts,
      1,
    );
    expect(keys).toEqual(["prec:1"]);
  });
});

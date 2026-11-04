// 사안 입력 규칙(case-input.ts) 자동 시험. 실행: npm test
import { describe, expect, it } from "vitest";
import { maskCaseInput, validateCaseInput } from "./case-input";

const good = {
  facts: "국유지인 도로 부지 일부를 10년 넘게 창고 앞마당으로 써 온 민원인에게 변상금을 부과했고, 민원인이 이의를 제기했다.",
  issue: "변상금 부과가 정당한지",
  field: "국유재산 관리",
  localGov: "",
};

describe("입력 검사", () => {
  it("필수 칸이 채워지면 통과하고 앞뒤 빈칸을 정리한다", () => {
    const result = validateCaseInput({ ...good, field: "  국유재산 관리  ", localGov: " 순천시 " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.field).toBe("국유재산 관리");
      expect(result.data.localGov).toBe("순천시");
    }
  });

  it("관련 분야·관련 지자체는 비워도 된다", () => {
    expect(validateCaseInput({ ...good, field: "", localGov: "" }).ok).toBe(true);
  });

  it("사안 내용이 너무 짧으면 더 구체적으로 적도록 안내한다", () => {
    const result = validateCaseInput({ ...good, facts: "변상금 이의" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.facts).toContain("구체적으로");
  });

  it("빈칸만 있는 쟁점은 비어 있는 것으로 본다", () => {
    const result = validateCaseInput({ ...good, issue: "      " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.issue).toBeTruthy();
  });

  it("글자 수를 넘으면 안내한다", () => {
    const result = validateCaseInput({ ...good, localGov: "가".repeat(31) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.localGov).toContain("30자");
  });

  it("칸이 빠진 이상한 입력도 오류로 처리한다", () => {
    expect(validateCaseInput({ facts: good.facts }).ok).toBe(false);
    expect(validateCaseInput(null).ok).toBe(false);
  });
});

describe("개인정보 가림", () => {
  it("모든 칸에서 가리고, 종류별 개수를 합친다", () => {
    const { masked, findings } = maskCaseInput({
      ...good,
      facts: `${good.facts} 연락처 010-1234-5678`,
      issue: "홍길동 씨에게 010-9876-5432로 회신해도 되는지",
    });
    expect(masked.facts).not.toContain("010-1234-5678");
    expect(masked.issue).toBe("[이름] 씨에게 [전화번호]로 회신해도 되는지");
    expect(findings).toEqual(
      expect.arrayContaining([
        { kind: "phone", label: "전화번호", count: 2 },
        { kind: "name", label: "이름", count: 1 },
      ]),
    );
  });

  it("개인정보가 없으면 그대로", () => {
    const { masked, findings } = maskCaseInput(good);
    expect(masked).toEqual(good);
    expect(findings).toEqual([]);
  });
});

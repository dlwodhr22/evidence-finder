// 개인정보 가림 도구(pii.ts) 자동 시험. 실행: npm test
// Design Ref: §11 시험 계획 — 개인정보 가림은 Vitest로 자동 시험한다.
import { describe, expect, it } from "vitest";
import { describeFindings, maskPii } from "./pii";

// 가린 결과에 원래 값이 남아 있지 않은지 함께 확인한다.
function expectMasked(input: string, secret: string, label: string) {
  const { text } = maskPii(input);
  expect(text).not.toContain(secret);
  expect(text).toContain(`[${label}]`);
}

describe("형식이 분명한 개인정보는 가린다", () => {
  it("주민등록번호", () => {
    expectMasked("주민번호 900101-1234567 입니다", "900101-1234567", "주민등록번호");
    expectMasked("9001012234567", "9001012234567", "주민등록번호");
  });

  it("휴대전화·일반전화", () => {
    expectMasked("연락처 010-1234-5678", "010-1234-5678", "전화번호");
    expectMasked("01012345678로 연락", "01012345678", "전화번호");
    expectMasked("+82 10-1234-5678", "1234-5678", "전화번호");
    expectMasked("사무실 02-123-4567", "02-123-4567", "전화번호");
    expectMasked("031 123 4567", "031 123 4567", "전화번호");
  });

  it("이메일(앞부분이 숫자여도)", () => {
    expectMasked("hong@example.com 으로", "hong@example.com", "이메일");
    expectMasked("01012345678@example.com", "01012345678", "이메일");
  });

  it("사업자등록번호", () => {
    expectMasked("사업자 123-45-67890", "123-45-67890", "사업자등록번호");
  });

  it("주소의 자세한 부분", () => {
    expectMasked("세종대로 110에 삽니다", "세종대로 110", "주소");
    expectMasked("테헤란로 12길 34", "테헤란로 12길 34", "주소");
    expectMasked("산 123-4번지 토지", "123-4번지", "주소");
    expectMasked("101동 1203호", "101동 1203호", "주소");
  });
});

describe("호칭이 붙은 이름만 가린다", () => {
  it("이름 + 씨/님/귀하", () => {
    expectMasked("홍길동 씨가 이의를 제기했다", "홍길동", "이름");
    expectMasked("김영희님께 회신", "김영희", "이름");
    expectMasked("남궁민수 귀하", "남궁민수", "이름");
  });

  it("호칭이 남아 문장이 자연스럽다", () => {
    expect(maskPii("홍길동 씨가 왔다").text).toBe("[이름] 씨가 왔다");
    expect(maskPii("김영희님께").text).toBe("[이름]님께");
  });

  it("사람 이름이 아닌 낱말은 그대로 둔다", () => {
    for (const word of ["민원인님", "고객님", "주무관님", "선생님", "담당자님", "어머님", "이용자님"]) {
      expect(maskPii(word).text).toBe(word);
    }
    expect(maskPii("글솜씨가 좋다").text).toBe("글솜씨가 좋다");
  });
});

describe("법령·판례 정보와 일반 숫자는 건드리지 않는다", () => {
  it.each([
    "국유재산법 제72조 제1항",
    "대법원 2024두31284 판결",
    "선고일자 2024.06.27",
    "변상금 1,234,560원",
    "2020경기행심2287",
    "진입로 2곳을 막았다",
    "10년 동안 창고로 사용",
    "면적 330㎡",
  ])("%s", (text) => {
    const result = maskPii(text);
    expect(result.text).toBe(text);
    expect(result.findings).toHaveLength(0);
  });
});

describe("가린 결과 안내", () => {
  it("종류와 개수만 알려주고 원래 값은 없다", () => {
    const result = maskPii("홍길동 씨 010-1234-5678, 010-9876-5432");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        { kind: "phone", label: "전화번호", count: 2 },
        { kind: "name", label: "이름", count: 1 },
      ]),
    );
    expect(JSON.stringify(result.findings)).not.toContain("010");
    expect(describeFindings(result.findings)).toContain("전화번호 2건");
  });

  it("가린 것이 없으면 안내도 없다", () => {
    expect(describeFindings(maskPii("국유재산 무단점유").findings)).toBe("");
  });
});

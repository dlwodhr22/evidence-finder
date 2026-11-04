// 판례 도구(cases.ts) 자동 시험. 실행: npm test
// 법제처에 실제로 묻지 않고, 2026-11-04에 확인한 실제 응답 모양을 본떠 시험한다.
import { describe, expect, it } from "vitest";
import {
  htmlToText,
  isSameCase,
  normalizeCaseNumber,
  normalizeCourt,
  normalizeDate,
  toConstitutionalItem,
  toPrecedentItem,
} from "./cases";

describe("표기 정리", () => {
  it.each([
    ["20240627", "2024-06-27"],
    ["2024.06.27", "2024-06-27"],
    ["2024. 6. 27.", "2024-06-27"],
    ["2024-6-27", "2024-06-27"],
    ["2024년 6월 27일", "2024-06-27"],
    ["0", ""],
    ["", ""],
    ["2024.13.01", ""],
  ])("날짜 %s → %s", (raw, expected) => {
    expect(normalizeDate(raw)).toBe(expected);
  });

  it("사건번호: 띄어쓰기·전각 숫자·끝의 호", () => {
    expect(normalizeCaseNumber("2024 두 31284")).toBe("2024두31284");
    expect(normalizeCaseNumber("２０２４두３１２８４")).toBe("2024두31284");
    expect(normalizeCaseNumber("2019헌바136호")).toBe("2019헌바136");
  });

  it("법원 이름: 줄임말과 띄어쓰기", () => {
    expect(normalizeCourt("대법")).toBe("대법원");
    expect(normalizeCourt("헌재")).toBe("헌법재판소");
    expect(normalizeCourt("서울고법")).toBe("서울고등법원");
    expect(normalizeCourt("서울 고등법원")).toBe("서울고등법원");
    expect(normalizeCourt("수원지법")).toBe("수원지방법원");
    expect(normalizeCourt("서울행법")).toBe("서울행정법원");
  });
});

describe("같은 판례인지 — 사건번호·법원·선고일이 모두 맞아야 한다", () => {
  const item = { caseNumber: "2024두31284", court: "대법원", decisionDate: "2024-06-27" };

  it("세 가지가 모두 같으면 같은 판례(표기 차이는 무시)", () => {
    expect(isSameCase(item, { caseNumber: "2024 두 31284", court: "대법", decisionDate: "2024. 6. 27." })).toBe(true);
  });

  it("하나라도 다르면 다른 판례", () => {
    expect(isSameCase(item, { caseNumber: "2024두31285", court: "대법원", decisionDate: "2024-06-27" })).toBe(false);
    expect(isSameCase(item, { caseNumber: "2024두31284", court: "서울고법", decisionDate: "2024-06-27" })).toBe(false);
    expect(isSameCase(item, { caseNumber: "2024두31284", court: "대법원", decisionDate: "2024-06-28" })).toBe(false);
  });

  it("하나라도 없으면 확인된 것으로 보지 않는다", () => {
    expect(isSameCase(item, { caseNumber: "2024두31284", court: "대법원" })).toBe(false);
    expect(isSameCase(item, { caseNumber: "2024두31284", decisionDate: "2024-06-27" })).toBe(false);
    expect(isSameCase(item, { court: "대법원", decisionDate: "2024-06-27" })).toBe(false);
  });
});

describe("판결문 HTML 정리 — 글자는 바꾸지 않는다", () => {
  it("줄바꿈 표시와 기호 표기만 바꾼다", () => {
    expect(htmlToText("【주    문】<br/>상고를 기각한다.<br/>&lt;개정 2011.3.30&gt;")).toBe(
      "【주    문】\n상고를 기각한다.\n<개정 2011.3.30>",
    );
  });

  it("그 밖의 표시는 지운다", () => {
    expect(htmlToText("<b>판시사항</b> 내용 &amp; 기타")).toBe("판시사항 내용 & 기타");
  });
});

describe("검색 결과 정리 — 필수 정보가 빠지면 내보내지 않는다", () => {
  const prec = {
    판례일련번호: "242107",
    사건번호: "2024두31284",
    법원명: "대법원",
    선고일자: "2024.06.27",
    사건명: "변상금부과처분취소",
    판결유형: "판결",
  };

  it("판례: 공개 링크와 날짜가 채워진다", () => {
    expect(toPrecedentItem(prec)).toEqual({
      kind: "case",
      source: "prec",
      id: "242107",
      title: "변상금부과처분취소",
      caseNumber: "2024두31284",
      court: "대법원",
      decisionDate: "2024-06-27",
      decisionType: "판결",
      sourceUrl: "https://www.law.go.kr/precInfoP.do?precSeq=242107",
    });
  });

  it.each(["판례일련번호", "사건번호", "법원명", "선고일자"])("판례: %s가 없으면 null", (key) => {
    expect(toPrecedentItem({ ...prec, [key]: "" })).toBeNull();
  });

  const detc = {
    헌재결정례일련번호: "151096",
    사건번호: "2021헌마918",
    종국일자: "2021.08.17",
    사건명: "구 국유재산법  제51조 제1항  위헌소원 등",
  };

  it("헌재 결정: 법원은 헌법재판소, 사건명 띄어쓰기 정리", () => {
    const item = toConstitutionalItem(detc);
    expect(item?.court).toBe("헌법재판소");
    expect(item?.title).toBe("구 국유재산법 제51조 제1항 위헌소원 등");
    expect(item?.sourceUrl).toBe("https://www.law.go.kr/detcInfoP.do?detcSeq=151096");
  });

  it('헌재 결정: 결정일이 "0"(없음)이면 null', () => {
    expect(toConstitutionalItem({ ...detc, 종국일자: "0" })).toBeNull();
  });
});

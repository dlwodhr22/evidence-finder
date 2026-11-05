// 접근 코드(access.ts) 자동 시험. 실행: npm test
import { describe, expect, it } from "vitest";
import { checkCode, gateMode, isAuthorized, safeEqual, tokenFor } from "./access";

describe("접근 코드 모드", () => {
  it("코드가 있으면 보호, 없으면 개발 중에는 열림·운영에서는 막힘", () => {
    expect(gateMode({ APP_ACCESS_CODE: "abc", NODE_ENV: "production" })).toBe("protected");
    expect(gateMode({ NODE_ENV: "development" })).toBe("open");
    expect(gateMode({})).toBe("open");
    expect(gateMode({ NODE_ENV: "production" })).toBe("misconfigured");
    expect(gateMode({ APP_ACCESS_CODE: "   ", NODE_ENV: "production" })).toBe("misconfigured");
  });
});

describe("코드 확인", () => {
  const env = { APP_ACCESS_CODE: "비밀-코드 1234" };
  it("맞는 코드만 통과한다(앞뒤 빈칸은 무시)", async () => {
    expect(await checkCode("비밀-코드 1234", env)).toBe(true);
    expect(await checkCode("  비밀-코드 1234  ", env)).toBe(true);
    expect(await checkCode("비밀-코드 1235", env)).toBe(false);
    expect(await checkCode("", env)).toBe(false);
  });
  it("설정된 코드가 없으면 어떤 입력도 통과하지 못한다", async () => {
    expect(await checkCode("아무거나", {})).toBe(false);
  });
});

describe("쿠키 확인", () => {
  const env = { APP_ACCESS_CODE: "코드A" };
  it("같은 코드로 만든 쿠키만 통과한다", async () => {
    const ok = await tokenFor("코드A");
    expect(await isAuthorized(ok, env)).toBe(true);
    expect(await isAuthorized(await tokenFor("코드B"), env)).toBe(false);
    expect(await isAuthorized("엉터리", env)).toBe(false);
    expect(await isAuthorized(undefined, env)).toBe(false);
  });
  it("쿠키 값은 코드 자체가 아니다", async () => {
    const token = await tokenFor("코드A");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain("코드A");
  });
  it("코드를 바꾸면 이전 쿠키는 무효가 된다", async () => {
    const old = await tokenFor("코드A");
    expect(await isAuthorized(old, { APP_ACCESS_CODE: "새코드" })).toBe(false);
  });
});

describe("safeEqual", () => {
  it("같은 글만 true", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

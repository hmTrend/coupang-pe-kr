import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAdminAuth, extractApiKey, matchApiKey, parseApiKeys, safeEqual } from "./auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeEqual", () => {
  it("같은 문자열만 true", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("한글키", "한글키")).toBe(true);
  });
});

describe("parseApiKeys / matchApiKey", () => {
  it("operator:KEY 쉼표 목록을 파싱한다", () => {
    expect(parseApiKeys("nsv-a:KEY1, nsv-b:KEY2 ,,")).toEqual([
      { operator: "nsv-a", key: "KEY1" },
      { operator: "nsv-b", key: "KEY2" },
    ]);
  });

  it("키에 ':' 가 들어 있어도 첫 ':' 로만 나눈다", () => {
    expect(parseApiKeys("op:ab:cd")).toEqual([{ operator: "op", key: "ab:cd" }]);
  });

  it("':' 가 없으면 operator 는 default", () => {
    expect(parseApiKeys("ONLYKEY")).toEqual([{ operator: "default", key: "ONLYKEY" }]);
  });

  it("미설정/빈 값이면 빈 목록", () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys("")).toEqual([]);
    expect(parseApiKeys(" , ")).toEqual([]);
    expect(parseApiKeys("op:")).toEqual([]);
  });

  it("제시한 키에 해당하는 operator 를 찾는다", () => {
    const entries = parseApiKeys("a:K1,b:K2");
    expect(matchApiKey(entries, "K2")).toBe("b");
    expect(matchApiKey(entries, "K3")).toBeNull();
    expect(matchApiKey(entries, "")).toBeNull();
  });
});

describe("extractApiKey", () => {
  it("Authorization Bearer 와 x-api-key 를 모두 지원한다", () => {
    expect(extractApiKey(new Headers({ authorization: "Bearer abc123" }))).toBe("abc123");
    expect(extractApiKey(new Headers({ authorization: "bearer   abc123 " }))).toBe("abc123");
    expect(extractApiKey(new Headers({ "x-api-key": "xyz" }))).toBe("xyz");
    expect(extractApiKey(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(extractApiKey(new Headers())).toBeNull();
  });
});

describe("checkAdminAuth", () => {
  const basic = (user: string, pass: string) =>
    `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

  it("ADMIN_PASSWORD 미설정이면 disabled", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(checkAdminAuth(basic("admin", ""))).toBe("disabled");
  });

  it("올바른 자격증명만 ok (사용자 기본값 admin)", () => {
    vi.stubEnv("ADMIN_PASSWORD", "s3cret:pw");
    vi.stubEnv("ADMIN_USER", "");
    expect(checkAdminAuth(basic("admin", "s3cret:pw"))).toBe("ok");
    expect(checkAdminAuth(basic("admin", "wrong"))).toBe("unauthorized");
    expect(checkAdminAuth(basic("root", "s3cret:pw"))).toBe("unauthorized");
    expect(checkAdminAuth(null)).toBe("unauthorized");
    expect(checkAdminAuth("Bearer x")).toBe("unauthorized");
    expect(checkAdminAuth("Basic !!!not-base64")).toBe("unauthorized");
  });

  it("ADMIN_USER 를 바꿀 수 있고 한글 비밀번호도 처리한다", () => {
    vi.stubEnv("ADMIN_PASSWORD", "비밀번호");
    vi.stubEnv("ADMIN_USER", "ops");
    expect(checkAdminAuth(basic("ops", "비밀번호"))).toBe("ok");
    expect(checkAdminAuth(basic("admin", "비밀번호"))).toBe("unauthorized");
  });
});

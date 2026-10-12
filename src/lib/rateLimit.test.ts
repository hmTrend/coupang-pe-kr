import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimit, clientIp, rateLimit } from "./rateLimit";

beforeEach(() => __resetRateLimit());

describe("rateLimit", () => {
  it("윈도우 안에서 한도를 넘으면 막고, 윈도우가 지나면 초기화된다", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("ip", 3, 60_000, t).ok).toBe(true);
    const blocked = rateLimit("ip", 3, 60_000, t + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(59);

    expect(rateLimit("ip", 3, 60_000, t + 60_001).ok).toBe(true);
  });

  it("키별로 독립적이다", () => {
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000, 1).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000, 1).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("cf-connecting-ip > x-real-ip > x-forwarded-for 첫 항목 순", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers({ "x-forwarded-for": "3.3.3.3, 4.4.4.4" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

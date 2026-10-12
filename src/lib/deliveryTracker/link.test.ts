import { afterEach, describe, expect, it, vi } from "vitest";
import { TRACKING_LINK_BASE, trackingLinkUrl } from "./link";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trackingLinkUrl", () => {
  it("client_id / carrier_id / tracking_number 쿼리를 만든다", () => {
    const url = trackingLinkUrl("10332152871106", { clientId: "abc123", carrierId: "kr.coupangls" });
    expect(url).toBe(`${TRACKING_LINK_BASE}?client_id=abc123&carrier_id=kr.coupangls&tracking_number=10332152871106`);
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe("https://link.tracker.delivery/track");
    expect(parsed.searchParams.get("client_id")).toBe("abc123");
    expect(parsed.searchParams.get("carrier_id")).toBe("kr.coupangls");
    expect(parsed.searchParams.get("tracking_number")).toBe("10332152871106");
  });

  it("Client Id 가 없으면 null (버튼 숨김)", () => {
    expect(trackingLinkUrl("10332152871106", { clientId: undefined, carrierId: "kr.coupangls" })).toBeNull();
    expect(trackingLinkUrl("10332152871106", { clientId: "", carrierId: "kr.coupangls" })).toBeNull();
  });

  it("값은 URL 인코딩된다", () => {
    const url = trackingLinkUrl("1 2&x=y", { clientId: "a b", carrierId: "kr.x" })!;
    expect(new URL(url).searchParams.get("tracking_number")).toBe("1 2&x=y");
    expect(new URL(url).searchParams.get("client_id")).toBe("a b");
    expect(url.split("?")[1].split("&")).toHaveLength(3);
  });

  it("환경변수 기본값을 쓰되 Client Secret 은 URL 에 들어가지 않는다", () => {
    vi.stubEnv("DELIVERY_TRACKER_CLIENT_ID", "env-client-id");
    vi.stubEnv("DELIVERY_TRACKER_CLIENT_SECRET", "env-super-secret");
    vi.stubEnv("DELIVERY_TRACKER_CARRIER_ID", "");
    const url = trackingLinkUrl("10332152871106")!;
    expect(url).toContain("client_id=env-client-id");
    expect(url).toContain("carrier_id=kr.coupangls");
    expect(url).not.toContain("env-super-secret");
    expect(url.toLowerCase()).not.toContain("secret");
  });

  it("환경변수에 Client Id 가 없으면 null", () => {
    vi.stubEnv("DELIVERY_TRACKER_CLIENT_ID", "");
    vi.stubEnv("DELIVERY_TRACKER_CLIENT_SECRET", "only-secret");
    expect(trackingLinkUrl("10332152871106")).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDefaultClientForTest } from "@/lib/deliveryTracker/client";
import { loadGraphql } from "@/lib/deliveryTracker/__fixtures__/load";
import { __resetRateLimit } from "@/lib/rateLimit";
import { MemoryInvoiceStore } from "@/lib/store/memory";
import { __setStoreForTest } from "@/lib/store";
import { GET } from "./route";

const call = (invoiceNo: string, ip = "9.9.9.9", query = "") =>
  GET(new Request(`http://localhost/api/track/${invoiceNo}${query}`, { headers: { "x-real-ip": ip } }), {
    params: Promise.resolve({ invoiceNo }),
  });

const NO = "10332152871106";
const SECRET = "route-test-secret-DO-NOT-LEAK";

function stubCredentials() {
  vi.stubEnv("DELIVERY_TRACKER_CLIENT_ID", "route-test-id");
  vi.stubEnv("DELIVERY_TRACKER_CLIENT_SECRET", SECRET);
  vi.stubEnv("DELIVERY_TRACKER_ENDPOINT", "https://tracker.test/graphql");
}

beforeEach(() => {
  __setStoreForTest(new MemoryInvoiceStore());
  __resetRateLimit();
  __resetDefaultClientForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __setStoreForTest(undefined);
  __resetDefaultClientForTest();
});

describe("GET /api/track/[invoiceNo]", () => {
  it("유효하지 않은 번호는 400 + invalid JSON (업스트림 호출 없음)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call("abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "invalid", stale: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("IP 당 분당 한도를 넘으면 429 + Retry-After", async () => {
    vi.stubEnv("API_RATE_LIMIT_PER_MIN", "3");
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call("abc")).status);
    expect(statuses).toEqual([400, 400, 400, 429, 429]);

    const limited = await call("abc");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    // 다른 IP 는 영향 없음
    expect((await call("abc", "8.8.8.8")).status).toBe(400);
  });

  it("조회 성공: Delivery Tracker 응답을 매핑해 200 + ok JSON (Secret 은 응답에 없음)", async () => {
    stubCredentials();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json(loadGraphql("delivered")));

    const res = await call(NO);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", invoiceNo: NO, stale: false });
    expect(body.data.delivered).toBe(true);
    expect(body.data.currentStep).toBe("배송완료");
    expect(JSON.stringify(body)).not.toContain(SECRET);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://tracker.test/graphql");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`TRACKQL-API-KEY route-test-id:${SECRET}`);

    // 같은 번호 재조회는 저장된 스냅샷(배송완료)을 쓴다
    const again = await call(NO);
    expect((await again.json()).status).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("NOT_FOUND 는 200 + not_found JSON", async () => {
    stubCredentials();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(loadGraphql("not-found")));
    const res = await call(NO);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not_found", invoiceNo: NO });
  });

  it("자격증명이 없으면 503 + not_configured (외부 호출 없음)", async () => {
    vi.stubEnv("DELIVERY_TRACKER_CLIENT_ID", "");
    vi.stubEnv("DELIVERY_TRACKER_CLIENT_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await call(NO);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "unavailable", reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("업스트림 오류는 503 + 일반화된 reason (내부 사유·코드 비노출)", async () => {
    stubCredentials();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(loadGraphql("forbidden")));

    const res = await call(NO);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: "unavailable", reason: "upstream_unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/FORBIDDEN|auth|Authorization/i);
  });
});

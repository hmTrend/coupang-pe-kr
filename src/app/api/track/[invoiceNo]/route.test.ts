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

describe("GET /api/track/[invoiceNo] - 등록 정보(meta)", () => {
  async function registerAndTrack(meta: Record<string, string>) {
    stubCredentials();
    const store = new MemoryInvoiceStore();
    __setStoreForTest(store);
    await store.upsertRegistrations([{ invoiceNo: NO, meta }], "nsv-operator", new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(loadGraphql("delivered")));
    return call(NO);
  }

  const fullMeta = {
    orderId: "ORD-SECRET-1",
    productName: "[노출] 빨간 양말 (L)",
    receiverName: "김*준",
    receiverAddress: "충청북도 청주시 용암동 **** 지음프라자 *** 호",
    deliveryMessage: "직접 받고 부재 시 문 앞 (*********)",
    orderedAt: "2026-10-08T09:00:00+09:00",
    memo: "내부메모-유출금지",
  };

  it("공개 JSON 에는 화면용 meta 4개만 나가고 orderId/memo/orderedAt/operator 는 없다", async () => {
    const res = await registerAndTrack(fullMeta);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toEqual({
      productName: "[노출] 빨간 양말 (L)",
      receiverAddress: "충청북도 청주시 용암동 **** 지음프라자 *** 호",
      deliveryMessage: "직접 받고 부재 시 문 앞 (*********)",
      receiverName: "김*준",
    });
    const text = JSON.stringify(body);
    for (const leaked of ["ORD-SECRET-1", "내부메모-유출금지", "2026-10-08T09:00:00+09:00", "nsv-operator", "orderId", "memo", "operator", "orderedAt"]) {
      expect(text, leaked).not.toContain(leaked);
    }
    // 조회 결과 자체는 그대로
    expect(body).toMatchObject({ status: "ok", invoiceNo: NO, stale: false });
  });

  it("미등록 번호의 공개 JSON 에는 meta 키가 없다", async () => {
    stubCredentials();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(loadGraphql("delivered")));
    const body = await (await call(NO)).json();
    expect(body.status).toBe("ok");
    expect("meta" in body).toBe(false);
  });
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

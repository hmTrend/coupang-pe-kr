import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryInvoiceStore } from "@/lib/store/memory";
import { __setStoreForTest } from "@/lib/store";
import { __resetRateLimit } from "@/lib/rateLimit";
import { POST } from "./route";

let store: MemoryInvoiceStore;

function request(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request("http://localhost/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

const auth = { authorization: "Bearer KEY-A" };

beforeEach(() => {
  store = new MemoryInvoiceStore();
  __setStoreForTest(store);
  __resetRateLimit();
  vi.stubEnv("INGEST_API_KEYS", "nsv-a:KEY-A,nsv-b:KEY-B");
});

afterEach(() => {
  vi.unstubAllEnvs();
  __setStoreForTest(undefined);
});

describe("POST /api/invoices", () => {
  it("키가 설정되지 않으면 503 (비활성)", async () => {
    vi.stubEnv("INGEST_API_KEYS", "");
    const res = await POST(request({ items: [] }, auth));
    expect(res.status).toBe(503);
  });

  it("키가 없거나 틀리면 401", async () => {
    expect((await POST(request({ items: [{ invoiceNo: "10332152871106" }] }))).status).toBe(401);
    const wrong = await POST(request({ items: [{ invoiceNo: "10332152871106" }] }, { authorization: "Bearer nope" }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toContain("Bearer");
    expect(await store.get("10332152871106")).toBeNull();
  });

  it("Authorization Bearer 와 x-api-key 둘 다 허용하고 키별 operator 가 저장된다", async () => {
    const r1 = await POST(request({ items: [{ invoiceNo: "10332152871106" }] }, auth));
    expect(r1.status).toBe(200);
    const r2 = await POST(request({ items: [{ invoiceNo: "10332152871107" }] }, { "x-api-key": "KEY-B" }));
    expect(r2.status).toBe(200);

    expect((await store.get("10332152871106"))?.operator).toBe("nsv-a");
    expect((await store.get("10332152871107"))?.operator).toBe("nsv-b");
  });

  it("응답 형식과 멱등성: 재전송은 updated, registeredAt 유지, invalid 보고", async () => {
    const body = {
      items: [
        { invoiceNo: "1033-2152-871106", carrier: "coupang", orderId: "O1", productName: "양말" },
        { invoiceNo: "bad" },
      ],
    };
    const first = await POST(request(body, auth));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      received: 2,
      upserted: 1,
      updated: 0,
      duplicates: 0,
      invalid: [{ index: 1, invoiceNo: "bad", reason: "invalid_invoice_no" }],
    });
    const registeredAt = (await store.get("10332152871106"))?.registeredAt?.getTime();

    await new Promise((r) => setTimeout(r, 5));
    const second = await POST(
      request({ items: [{ invoiceNo: "10332152871106", memo: "재전송" }] }, { "x-api-key": "KEY-B" }),
    );
    expect(await second.json()).toMatchObject({ ok: true, received: 1, upserted: 0, updated: 1 });

    const doc = await store.get("10332152871106");
    expect(doc?.registeredAt?.getTime()).toBe(registeredAt);
    expect(doc?.operator).toBe("nsv-a");
    expect(doc?.meta).toEqual({ orderId: "O1", productName: "양말", memo: "재전송" });
  });

  it("주소/배송메시지를 받아 마스킹된 값만 저장하고, 일부만 재전송하면 나머지는 유지한다", async () => {
    const first = await POST(
      request(
        {
          items: [
            {
              invoiceNo: "10332152871106",
              productName: "[노출] 양말 (L)",
              receiverAddress: "충청북도 청주시 용암동 1234 지음프라자 101호",
              deliveryMessage: "문 앞 (공동현관 1234) 비번 5678",
              orderId: "O1",
            },
            { invoiceNo: "10332152871107", receiverAddress: { bad: true } },
          ],
        },
        auth,
      ),
    );
    expect(await first.json()).toMatchObject({
      ok: true,
      upserted: 1,
      invalid: [{ index: 1, invoiceNo: "10332152871107", reason: "invalid_type:receiverAddress" }],
    });
    expect((await store.get("10332152871106"))?.meta).toEqual({
      orderId: "O1",
      productName: "[노출] 양말 (L)",
      receiverAddress: "충청북도 청주시 용암동 **** 지음프라자 ***호",
      deliveryMessage: "문 앞 (*********) 비번 ****",
    });
    expect(await store.get("10332152871107")).toBeNull();

    // 주소만 다시 보낸다: 배송메시지·상품명은 지워지지 않는다
    await POST(request({ items: [{ invoiceNo: "10332152871106", receiverAddress: "서울 은평구 연서로 12-3" }] }, auth));
    expect((await store.get("10332152871106"))?.meta).toEqual({
      orderId: "O1",
      productName: "[노출] 양말 (L)",
      receiverAddress: "서울 은평구 연서로 ***",
      deliveryMessage: "문 앞 (*********) 비번 ****",
    });
  });

  it("JSON 이 아니면 400, 501건이면 413, 빈 items 면 400", async () => {
    expect((await POST(request(null, auth, "{not json"))).status).toBe(400);
    const many = { items: Array.from({ length: 501 }, (_, i) => ({ invoiceNo: String(10_000_000_000_000 + i) })) };
    expect((await POST(request(many, auth))).status).toBe(413);
    expect((await POST(request({ items: [] }, auth))).status).toBe(400);
  });

  it("인증 실패가 반복되면 429 로 막는다", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) {
      const res = await POST(request({ items: [] }, { authorization: "Bearer nope", "x-real-ip": "1.2.3.4" }));
      last = res.status;
    }
    expect(last).toBe(429);
    // 다른 IP 는 영향 없음
    const other = await POST(request({ items: [] }, { authorization: "Bearer nope", "x-real-ip": "5.6.7.8" }));
    expect(other.status).toBe(401);
  });

  it("배송 조회 API 를 호출하지 않는다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await POST(request({ items: [{ invoiceNo: "10332152871106" }] }, auth));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

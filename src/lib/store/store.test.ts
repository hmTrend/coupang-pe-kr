// InvoiceStore 계약 테스트: 인메모리 구현은 항상, Mongo 구현은 TEST_MONGODB_URI 가 있을 때만 실행한다.
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
import { MongoClient } from "mongodb";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadTrackingData } from "@/lib/deliveryTracker/__fixtures__/load";
import { MemoryInvoiceStore } from "./memory";
import { MongoInvoiceStore } from "./mongo";
import type { InvoiceStore } from "./types";

const delivered = loadTrackingData("delivered");

const T0 = new Date("2026-10-08T01:00:00Z");
const T1 = new Date("2026-10-08T02:00:00Z");
const T2 = new Date("2026-10-08T03:00:00Z");

interface Harness {
  name: string;
  create: () => Promise<{ store: InvoiceStore; cleanup: () => Promise<void> }>;
  skip: boolean;
}

const mongoUri = process.env.TEST_MONGODB_URI;

const harnesses: Harness[] = [
  {
    name: "MemoryInvoiceStore",
    skip: false,
    create: async () => ({ store: new MemoryInvoiceStore(), cleanup: async () => undefined }),
  },
  {
    name: "MongoInvoiceStore",
    skip: !mongoUri,
    create: async () => {
      const dbName = `coupang_pe_kr_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const store = new MongoInvoiceStore(mongoUri as string, dbName);
      return {
        store,
        cleanup: async () => {
          const client = new MongoClient(mongoUri as string);
          await client.db(dbName).dropDatabase();
          await client.close();
        },
      };
    },
  },
];

for (const harness of harnesses) {
  describe.skipIf(harness.skip)(`InvoiceStore 계약: ${harness.name}`, () => {
    let store: InvoiceStore;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      if (cleanup) await cleanup();
      ({ store, cleanup } = await harness.create());
    });
    afterAll(async () => {
      if (cleanup) await cleanup();
    });

    it("신규 등록은 upserted, 재전송은 updated 이고 registeredAt/operator 는 유지된다", async () => {
      const first = await store.upsertRegistrations(
        [
          { invoiceNo: "1111111111111", meta: { orderId: "O-1", productName: "양말" } },
          { invoiceNo: "2222222222222", meta: {} },
        ],
        "nsv-a",
        T0,
      );
      expect(first).toEqual({ upserted: 2, updated: 0 });

      const again = await store.upsertRegistrations(
        [{ invoiceNo: "1111111111111", meta: { productName: "수건", memo: "재전송" } }],
        "nsv-b",
        T1,
      );
      expect(again).toEqual({ upserted: 0, updated: 1 });

      const doc = await store.get("1111111111111");
      expect(doc).toMatchObject({
        _id: "1111111111111",
        registered: true,
        operator: "nsv-a", // 유지
        // 보낸 필드만 갱신, 안 보낸 필드(orderId)는 유지
        meta: { orderId: "O-1", productName: "수건", memo: "재전송" },
        snapshot: null,
        snapshotKind: null,
        snapshotAt: null,
        delivered: false,
      });
      expect(doc?.registeredAt?.getTime()).toBe(T0.getTime());
      expect(doc?.createdAt.getTime()).toBe(T0.getTime());
      expect(doc?.updatedAt.getTime()).toBe(T1.getTime());
    });

    it("조회만 되어 있던 번호를 등록하면 신규 등록으로 세고 스냅샷은 유지한다", async () => {
      await store.saveSnapshot("1111111111111", { kind: "ok", data: delivered }, T0);
      expect((await store.get("1111111111111"))?.registered).toBe(false);

      const result = await store.upsertRegistrations(
        [{ invoiceNo: "1111111111111", meta: { orderId: "O-9" } }],
        "nsv",
        T1,
      );
      expect(result).toEqual({ upserted: 1, updated: 0 });

      const doc = await store.get("1111111111111");
      expect(doc).toMatchObject({ registered: true, operator: "nsv", snapshotKind: "ok", delivered: true });
      expect(doc?.registeredAt?.getTime()).toBe(T1.getTime());
      expect(doc?.createdAt.getTime()).toBe(T0.getTime());
    });

    it("saveSnapshot: ok / not_found 를 저장하고 문서가 없으면 registered:false 로 만든다", async () => {
      await store.saveSnapshot("3333333333333", { kind: "ok", data: delivered }, T0);
      let doc = await store.get("3333333333333");
      expect(doc).toMatchObject({ registered: false, snapshotKind: "ok", delivered: true });
      expect(doc?.snapshot?.latest?.status).toBe("배송완료");
      expect(doc?.snapshotAt?.getTime()).toBe(T0.getTime());

      await store.saveSnapshot(
        "4444444444444",
        { kind: "not_found", title: "검색결과가 없습니다.", message: "준비중" },
        T1,
      );
      doc = await store.get("4444444444444");
      expect(doc).toMatchObject({
        registered: false,
        snapshot: null,
        snapshotKind: "not_found",
        delivered: false,
        notFound: { title: "검색결과가 없습니다.", message: "준비중" },
      });
    });

    it("saveAttemptError 는 스냅샷을 건드리지 않고 lastError 만 기록하며, 다음 성공 저장이 지운다", async () => {
      await store.saveSnapshot("5555555555555", { kind: "ok", data: delivered }, T0);
      await store.saveAttemptError("5555555555555", "blocked", T1);

      let doc = await store.get("5555555555555");
      expect(doc?.snapshotKind).toBe("ok");
      expect(doc?.snapshotAt?.getTime()).toBe(T0.getTime());
      expect(doc?.lastError).toBe("blocked");
      expect(doc?.lastAttemptAt?.getTime()).toBe(T1.getTime());

      await store.saveSnapshot("5555555555555", { kind: "ok", data: delivered }, T2);
      doc = await store.get("5555555555555");
      expect(doc?.lastError).toBeUndefined();
      expect(doc?.snapshotAt?.getTime()).toBe(T2.getTime());
    });

    it("saveAttemptError 는 문서가 없어도 빈 캐시 문서를 만든다", async () => {
      await store.saveAttemptError("6666666666666", "error:timeout", T0);
      expect(await store.get("6666666666666")).toMatchObject({
        registered: false,
        snapshot: null,
        snapshotKind: null,
        lastError: "error:timeout",
      });
    });

    it("get 은 없는 번호에 null", async () => {
      expect(await store.get("9999999999999")).toBeNull();
    });

    it("listRegistered: 등록된 것만 최신 등록순으로, 검색과 페이지네이션 지원", async () => {
      await store.saveSnapshot("7000000000000", { kind: "ok", data: delivered }, T0); // 미등록
      await store.upsertRegistrations(
        [{ invoiceNo: "1000000000001", meta: { productName: "빨간 양말", orderId: "ORD-AAA" } }],
        "a",
        new Date("2026-10-01T00:00:00Z"),
      );
      await store.upsertRegistrations(
        [{ invoiceNo: "1000000000002", meta: { productName: "파란 수건", orderId: "ORD-BBB" } }],
        "a",
        new Date("2026-10-02T00:00:00Z"),
      );
      await store.upsertRegistrations(
        [{ invoiceNo: "1000000000003", meta: { productName: "노란 양말", orderId: "ORD-CCC" } }],
        "b",
        new Date("2026-10-03T00:00:00Z"),
      );

      const all = await store.listRegistered({ page: 1, pageSize: 50 });
      expect(all.total).toBe(3);
      expect(all.items.map((d) => d._id)).toEqual(["1000000000003", "1000000000002", "1000000000001"]);

      const socks = await store.listRegistered({ q: "양말", page: 1, pageSize: 50 });
      expect(socks.items.map((d) => d._id)).toEqual(["1000000000003", "1000000000001"]);
      expect(socks.total).toBe(2);

      expect((await store.listRegistered({ q: "ord-bbb", page: 1, pageSize: 50 })).items.map((d) => d._id)).toEqual([
        "1000000000002",
      ]);
      expect((await store.listRegistered({ q: "0000000001", page: 1, pageSize: 50 })).items.map((d) => d._id)).toEqual([
        "1000000000001",
      ]);
      // 정규식 특수문자가 그대로 검색어로 취급되어야 한다
      expect((await store.listRegistered({ q: ".*", page: 1, pageSize: 50 })).total).toBe(0);

      const page2 = await store.listRegistered({ page: 2, pageSize: 2 });
      expect(page2.total).toBe(3);
      expect(page2.items.map((d) => d._id)).toEqual(["1000000000001"]);
    });
  });
}

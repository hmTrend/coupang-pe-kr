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

    it("주소/배송메시지가 meta 에 저장되고, 일부만 다시 보내도 기존 필드(안 보낸 것)는 지워지지 않는다", async () => {
      await store.upsertRegistrations(
        [
          {
            invoiceNo: "1111111111111",
            meta: {
              orderId: "O-1",
              productName: "빨간 양말 (L)",
              receiverName: "김*준",
              receiverAddress: "충청북도 청주시 용암동 **** 지음프라자 *** 호",
              deliveryMessage: "문 앞 (*********)",
              memo: "선물포장",
            },
          },
        ],
        "nsv",
        T0,
      );

      // 배송메시지만 다시 보낸다 (주소·상품명 등은 보내지 않음)
      await store.upsertRegistrations(
        [{ invoiceNo: "1111111111111", meta: { deliveryMessage: "경비실 (*********)" } }],
        "nsv",
        T1,
      );
      expect((await store.get("1111111111111"))?.meta).toEqual({
        orderId: "O-1",
        productName: "빨간 양말 (L)",
        receiverName: "김*준",
        receiverAddress: "충청북도 청주시 용암동 **** 지음프라자 *** 호",
        deliveryMessage: "경비실 (*********)",
        memo: "선물포장",
      });

      // 빈 meta 로 다시 보내도 아무것도 지워지지 않는다
      await store.upsertRegistrations([{ invoiceNo: "1111111111111", meta: {} }], "nsv", T2);
      expect((await store.get("1111111111111"))?.meta).toMatchObject({
        productName: "빨간 양말 (L)",
        receiverAddress: "충청북도 청주시 용암동 **** 지음프라자 *** 호",
        deliveryMessage: "경비실 (*********)",
      });
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

    it("saveFetchedMeta: 문서가 없으면 registered:false 로 만들고 meta / metaFetchedAt / metaSource 를 기록한다", async () => {
      await store.saveFetchedMeta("8888888888888", { productName: "양말", receiverAddress: "서울 *** ***동" }, T0);
      const doc = await store.get("8888888888888");
      expect(doc).toMatchObject({
        registered: false,
        meta: { productName: "양말", receiverAddress: "서울 *** ***동" },
        metaSource: "nsv",
        snapshot: null,
        snapshotKind: null,
        delivered: false,
      });
      expect(doc?.metaFetchedAt?.getTime()).toBe(T0.getTime());
      expect(doc?.metaNotFoundAt).toBeUndefined();
    });

    it("saveFetchedMeta: 값이 있는 필드만 병합하고(빈 값·undefined 는 기존 값 유지) 등록 정보·스냅샷·운영용 필드는 건드리지 않는다", async () => {
      await store.upsertRegistrations(
        [{ invoiceNo: "1111111111111", meta: { orderId: "O-1", memo: "메모", productName: "옛 상품명", receiverAddress: "옛 주소" } }],
        "nsv-a",
        T0,
      );
      await store.saveSnapshot("1111111111111", { kind: "ok", data: delivered }, T0);

      await store.saveFetchedMeta(
        "1111111111111",
        { productName: "새 상품명", receiverAddress: "", deliveryMessage: "  ", receiverName: undefined },
        T1,
      );
      const doc = await store.get("1111111111111");
      expect(doc?.meta).toEqual({ orderId: "O-1", memo: "메모", productName: "새 상품명", receiverAddress: "옛 주소" });
      expect(doc).toMatchObject({ registered: true, operator: "nsv-a", metaSource: "nsv", snapshotKind: "ok", delivered: true });
      expect(doc?.registeredAt?.getTime()).toBe(T0.getTime());
      expect(doc?.snapshotAt?.getTime()).toBe(T0.getTime());
      expect(doc?.metaFetchedAt?.getTime()).toBe(T1.getTime());
      expect(doc?.updatedAt.getTime()).toBe(T1.getTime());
    });

    it("saveMetaNotFound: 시각만 기록하고 기존 meta 는 유지하며, 문서가 없으면 registered:false 로 만든다. 이후 saveFetchedMeta 가 지운다", async () => {
      await store.saveMetaNotFound("2222222222222", T0);
      let doc = await store.get("2222222222222");
      expect(doc).toMatchObject({ registered: false, snapshot: null, snapshotKind: null, delivered: false });
      expect(doc?.metaNotFoundAt?.getTime()).toBe(T0.getTime());
      expect(doc?.meta).toBeUndefined();
      expect(doc?.metaFetchedAt).toBeUndefined();

      await store.upsertRegistrations([{ invoiceNo: "3333333333333", meta: { productName: "양말" } }], "nsv", T0);
      await store.saveFetchedMeta("3333333333333", { receiverName: "홍*동" }, T0);
      await store.saveMetaNotFound("3333333333333", T1);
      doc = await store.get("3333333333333");
      expect(doc?.meta).toEqual({ productName: "양말", receiverName: "홍*동" });
      expect(doc?.metaNotFoundAt?.getTime()).toBe(T1.getTime());
      expect(doc?.metaFetchedAt?.getTime()).toBe(T0.getTime());

      await store.saveFetchedMeta("3333333333333", { productName: "수건" }, T2);
      doc = await store.get("3333333333333");
      expect(doc?.metaNotFoundAt).toBeUndefined();
      expect(doc?.metaFetchedAt?.getTime()).toBe(T2.getTime());
      expect(doc?.meta).toEqual({ productName: "수건", receiverName: "홍*동" });
    });

    it("pull 로 만들어진 미등록 문서를 수집 API 로 등록해도 pull 로 받은 meta 와 metaFetchedAt 은 유지된다", async () => {
      await store.saveFetchedMeta("4444444444444", { productName: "pull 상품명", receiverAddress: "pull 주소" }, T0);
      const result = await store.upsertRegistrations(
        [{ invoiceNo: "4444444444444", meta: { productName: "push 상품명", orderId: "O-9" } }],
        "nsv",
        T1,
      );
      expect(result).toEqual({ upserted: 1, updated: 0 });
      const doc = await store.get("4444444444444");
      expect(doc).toMatchObject({
        registered: true,
        meta: { productName: "push 상품명", receiverAddress: "pull 주소", orderId: "O-9" },
        metaSource: "nsv",
      });
      expect(doc?.metaFetchedAt?.getTime()).toBe(T0.getTime());
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTrackingData } from "@/lib/deliveryTracker/__fixtures__/load";
import type { TrackingData, UpstreamResult } from "@/lib/deliveryTracker/types";
import type { NsvMetaResult } from "@/lib/nsv/client";
import { MemoryInvoiceStore } from "@/lib/store/memory";
import type { InvoiceStore } from "@/lib/store/types";
import type { TrackingConfig } from "@/lib/config";
import { createTracker } from "./tracking";

const NO = "10332152871106";
const SEC = 1000;
const MIN = 60 * SEC;

const DELIVERED = loadTrackingData("delivered");
const IN_TRANSIT = loadTrackingData("in-transit");

const baseConfig: TrackingConfig = {
  cacheTtlMs: 120_000,
  notFoundTtlMs: 60_000,
  minForceRefreshMs: 30_000,
  deliveredRecheckMs: 3_600_000,
  allowUnregisteredLookup: true,
};

const ok = (data: TrackingData): UpstreamResult => ({ kind: "ok", data });
const notFound: UpstreamResult = { kind: "not_found" };

let clock: number;
let store: MemoryInvoiceStore;
let upstream: ReturnType<typeof vi.fn<(no: string) => Promise<UpstreamResult>>>;

function tracker(config: Partial<TrackingConfig> = {}, storeOverride?: InvoiceStore) {
  return createTracker({
    store: storeOverride ?? store,
    fetchUpstream: upstream,
    now: () => clock,
    config: { ...baseConfig, ...config },
  });
}

beforeEach(() => {
  clock = Date.parse("2026-10-08T10:00:00Z");
  store = new MemoryInvoiceStore();
  upstream = vi.fn<(no: string) => Promise<UpstreamResult>>();
});

describe("입력 정규화", () => {
  it.each(["", "abc", "123456789", "12345678901234567", "1033215287110a", "../x"])(
    "유효하지 않은 번호 %j 는 invalid 이고 업스트림을 부르지 않는다",
    async (input) => {
      const result = await tracker()(input);
      expect(result.status).toBe("invalid");
      expect(result.stale).toBe(false);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("공백·하이픈을 제거해 정규화한다", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const result = await tracker()(" 1033-2152 871106 ");
    expect(result.status).toBe("ok");
    expect(result.invoiceNo).toBe(NO);
    expect(upstream).toHaveBeenCalledWith(NO);
  });
});

describe("캐시 정책", () => {
  it("첫 조회는 업스트림을 호출하고 스냅샷을 저장한다 (미등록 번호도 registered:false 로)", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const result = await tracker()(NO);

    expect(result).toMatchObject({ status: "ok", invoiceNo: NO, stale: false });
    expect(result.data?.currentStep).toBe("이동");
    expect(result.fetchedAt).toBe(new Date(clock).toISOString());

    const doc = await store.get(NO);
    expect(doc).toMatchObject({
      registered: false,
      snapshotKind: "ok",
      delivered: false,
    });
    expect(doc?.snapshotAt?.getTime()).toBe(clock);
  });

  it("ok 스냅샷이 CACHE_TTL 이내면 캐시, 지나면 재조회", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const get = tracker();
    await get(NO);

    clock += 119 * SEC;
    const cached = await get(NO);
    expect(cached.status).toBe("ok");
    expect(upstream).toHaveBeenCalledTimes(1);

    clock += 2 * SEC; // 합계 121초
    await get(NO);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("캐시 응답의 fetchedAt 은 스냅샷 저장 시각이다", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const get = tracker();
    const first = await get(NO);
    clock += 60 * SEC;
    const second = await get(NO);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it("배송완료 스냅샷은 업스트림을 다시 부르지 않는다 (시간이 지나도)", async () => {
    upstream.mockResolvedValue(ok(DELIVERED));
    const get = tracker();
    const first = await get(NO);
    expect(first.data?.delivered).toBe(true);

    clock += 24 * 60 * MIN;
    const later = await get(NO);
    expect(later.status).toBe("ok");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect((await store.get(NO))?.delivered).toBe(true);
  });

  it("배송완료 + forceRefresh: 스냅샷이 1시간 이내면 캐시, 1시간이 지나면 재조회", async () => {
    upstream.mockResolvedValue(ok(DELIVERED));
    const get = tracker();
    await get(NO);

    clock += 59 * MIN;
    await get(NO, { forceRefresh: true });
    expect(upstream).toHaveBeenCalledTimes(1);

    clock += 2 * MIN; // 61분
    await get(NO, { forceRefresh: true });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("not_found 스냅샷은 NOT_FOUND_TTL 이내면 캐시, 지나면 재조회", async () => {
    upstream.mockResolvedValue(notFound);
    const get = tracker();
    const first = await get(NO);
    expect(first).toMatchObject({ status: "not_found", stale: false });
    expect(first.notFound?.title).toBe("검색결과가 없습니다.");

    clock += 59 * SEC;
    const cached = await get(NO);
    expect(cached.status).toBe("not_found");
    expect(cached.notFound?.message).toBe("운송장 미등록 상태이거나 업체에서 상품을 준비중입니다.");
    expect(upstream).toHaveBeenCalledTimes(1);

    clock += 2 * SEC;
    await get(NO);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("forceRefresh 는 스냅샷이 MIN_FORCE_REFRESH 보다 오래됐을 때만 반영된다", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const get = tracker();
    await get(NO);

    clock += 10 * SEC;
    await get(NO, { forceRefresh: true });
    expect(upstream).toHaveBeenCalledTimes(1); // 10초 < 30초: 무시

    clock += 25 * SEC; // 35초
    await get(NO, { forceRefresh: true });
    expect(upstream).toHaveBeenCalledTimes(2); // 반영

    clock += 35 * SEC; // 방금 갱신 후 35초, 일반 조회는 TTL(120초) 이내라 캐시
    await get(NO);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe("업스트림 실패 처리", () => {
  // [이름, 업스트림 결과, 저장소(lastError)에 남는 내부 사유, 응답(공개)의 reason]
  const failures: Array<[string, UpstreamResult, string, string]> = [
    ["rate_limited", { kind: "error", reason: "rate_limited" }, "error:rate_limited", "upstream_unavailable"],
    ["auth", { kind: "error", reason: "auth" }, "error:auth", "upstream_unavailable"],
    ["timeout", { kind: "error", reason: "timeout" }, "error:timeout", "upstream_unavailable"],
    ["server_error", { kind: "error", reason: "server_error" }, "error:server_error", "upstream_unavailable"],
    ["not_configured", { kind: "error", reason: "not_configured" }, "error:not_configured", "not_configured"],
  ];

  it.each(failures)("%s: 이전 스냅샷이 있으면 덮어쓰지 않고 stale 로 반환", async (_name, failure, lastError, reason) => {
    upstream.mockResolvedValueOnce(ok(IN_TRANSIT));
    const get = tracker();
    const first = await get(NO);
    const savedAt = (await store.get(NO))?.snapshotAt?.getTime();

    clock += 5 * MIN; // TTL 초과
    upstream.mockResolvedValueOnce(failure);
    const result = await get(NO);

    expect(result).toMatchObject({ status: "ok", stale: true, reason });
    expect(result.data).toEqual(first.data);
    expect(result.fetchedAt).toBe(first.fetchedAt);

    const doc = await store.get(NO);
    expect(doc?.snapshot).toEqual(IN_TRANSIT); // 스냅샷 보존
    expect(doc?.snapshotAt?.getTime()).toBe(savedAt);
    expect(doc?.lastError).toBe(lastError);
    expect(doc?.lastAttemptAt?.getTime()).toBe(clock);
  });

  it.each(failures)("%s: 이전 스냅샷이 없으면 unavailable", async (_name, failure, lastError, reason) => {
    upstream.mockResolvedValueOnce(failure);
    const result = await tracker()(NO);
    expect(result).toMatchObject({ status: "unavailable", stale: false, reason });
    expect(result.data).toBeUndefined();

    const doc = await store.get(NO);
    expect(doc).toMatchObject({ registered: false, snapshotKind: null, snapshot: null });
    expect(doc?.lastError).toBe(lastError);
  });

  it("실패 뒤 성공하면 lastError 가 지워진다", async () => {
    const get = tracker();
    upstream.mockResolvedValueOnce({ kind: "error", reason: "timeout" });
    await get(NO);
    expect((await store.get(NO))?.lastError).toBe("error:timeout");

    upstream.mockResolvedValueOnce(ok(IN_TRANSIT));
    await get(NO);
    expect((await store.get(NO))?.lastError).toBeUndefined();
  });

  it("배송완료 스냅샷이 있고 재확인(force, 1시간 경과)이 실패하면 stale 로 그대로 보여준다", async () => {
    upstream.mockResolvedValueOnce(ok(DELIVERED));
    const get = tracker();
    await get(NO);

    clock += 2 * 60 * MIN;
    upstream.mockResolvedValueOnce({ kind: "error", reason: "rate_limited" });
    const result = await get(NO, { forceRefresh: true });
    expect(result).toMatchObject({ status: "ok", stale: true, reason: "upstream_unavailable" });
    expect(result.data?.delivered).toBe(true);
  });

  it("not_found 스냅샷만 있고 실패하면 not_found + stale", async () => {
    upstream.mockResolvedValueOnce(notFound);
    const get = tracker();
    await get(NO);

    clock += 5 * MIN;
    upstream.mockResolvedValueOnce({ kind: "error", reason: "network" });
    const result = await get(NO);
    expect(result).toMatchObject({ status: "not_found", stale: true });
  });
});

describe("내부 사유 비노출", () => {
  it("업스트림 오류의 내부 사유(인증/호출 제한 등)는 공개 결과에 담기지 않고 저장소에만 남는다", async () => {
    const get = tracker();
    upstream.mockResolvedValueOnce(ok(IN_TRANSIT));
    await get(NO);

    clock += 10 * MIN;
    upstream.mockResolvedValueOnce({ kind: "error", reason: "auth" });
    const stale = await get(NO);
    expect(stale).toMatchObject({ status: "ok", stale: true, reason: "upstream_unavailable" });
    expect(JSON.stringify(stale)).not.toMatch(/auth|rate_limited|server_error|error:/);
    expect((await store.get(NO))?.lastError).toBe("error:auth");

    // 이전 스냅샷이 없는 번호도 마찬가지
    upstream.mockResolvedValueOnce({ kind: "error", reason: "rate_limited" });
    const unavailable = await get("10332152871107");
    expect(unavailable).toMatchObject({ status: "unavailable", reason: "upstream_unavailable" });
    expect(JSON.stringify(unavailable)).not.toMatch(/auth|rate_limited|server_error|error:/);
  });
});

describe("미등록 번호 정책", () => {
  it("ALLOW_UNREGISTERED_LOOKUP=false 면 미등록 번호는 업스트림 호출 없이 not_found", async () => {
    const get = tracker({ allowUnregisteredLookup: false });
    const result = await get(NO);
    expect(result).toMatchObject({ status: "not_found", reason: "unregistered_lookup_disabled" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("ALLOW_UNREGISTERED_LOOKUP=false 여도 등록된 번호는 조회된다", async () => {
    await store.upsertRegistrations([{ invoiceNo: NO, meta: {} }], "op", new Date(clock));
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const result = await tracker({ allowUnregisteredLookup: false })(NO);
    expect(result.status).toBe("ok");
    // 등록 상태는 유지된다
    expect((await store.get(NO))?.registered).toBe(true);
  });

  it("등록된 번호에 스냅샷을 저장해도 registered/meta 는 유지된다", async () => {
    await store.upsertRegistrations(
      [{ invoiceNo: NO, meta: { productName: "양말" } }],
      "nsv",
      new Date(clock),
    );
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    await tracker()(NO);
    const doc = await store.get(NO);
    expect(doc).toMatchObject({ registered: true, operator: "nsv", meta: { productName: "양말" } });
    expect(doc?.snapshotKind).toBe("ok");
  });
});

describe("화면용 meta", () => {
  const ADDRESS = "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호";
  const MESSAGE = "직접 받고 부재 시 문 앞 (*********)";
  const fullMeta = {
    orderId: "ORD-SECRET-1",
    productName: "[노출] 빨간 양말 (L)",
    receiverName: "김*준",
    receiverAddress: ADDRESS,
    deliveryMessage: MESSAGE,
    orderedAt: "2026-10-08T09:00:00+09:00",
    memo: "내부메모-유출금지",
  };
  const screenMeta = {
    productName: "[노출] 빨간 양말 (L)",
    receiverAddress: ADDRESS,
    deliveryMessage: MESSAGE,
    receiverName: "김*준",
  };

  const register = (meta: typeof fullMeta | Partial<typeof fullMeta> = fullMeta) =>
    store.upsertRegistrations([{ invoiceNo: NO, meta }], "nsv-operator", new Date(clock));

  it("업스트림 조회 결과에 화면용 meta 4개 필드만 담는다 (orderId/memo/orderedAt/operator 제외)", async () => {
    await register();
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const result = await tracker()(NO);

    expect(result.status).toBe("ok");
    expect(result.meta).toEqual(screenMeta);
    expect(Object.keys(result.meta ?? {}).sort()).toEqual(
      ["deliveryMessage", "productName", "receiverAddress", "receiverName"],
    );
    const json = JSON.stringify(result);
    for (const leaked of ["ORD-SECRET-1", "내부메모-유출금지", "2026-10-08T09:00:00+09:00", "nsv-operator", "orderId", "memo"]) {
      expect(json, leaked).not.toContain(leaked);
    }
  });

  it("캐시 히트에서도 저장소의 최신 meta 가 들어간다 (캐시 후 meta 가 갱신돼도 반영)", async () => {
    await register({ productName: "옛 상품명" });
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const get = tracker();
    const first = await get(NO);
    expect(first.meta).toEqual({ productName: "옛 상품명" });

    // 스냅샷은 그대로 두고 NSV 가 meta 를 다시 보낸다
    await register({ productName: "새 상품명", receiverAddress: ADDRESS });
    clock += 30 * SEC; // TTL(120초) 이내 -> 캐시
    const cached = await get(NO);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(cached.fetchedAt).toBe(first.fetchedAt);
    expect(cached.meta).toEqual({ productName: "새 상품명", receiverAddress: ADDRESS });
  });

  it("stale 경로(업스트림 실패 + 이전 스냅샷)에서도 meta 가 들어간다", async () => {
    await register();
    upstream.mockResolvedValueOnce(ok(IN_TRANSIT));
    const get = tracker();
    await get(NO);

    clock += 5 * MIN;
    upstream.mockResolvedValueOnce({ kind: "error", reason: "timeout" });
    const stale = await get(NO);
    expect(stale).toMatchObject({ status: "ok", stale: true });
    expect(stale.meta).toEqual(screenMeta);
  });

  it("배송완료 캐시(재조회 없음)와 not_found 응답에도 meta 가 들어간다", async () => {
    await register();
    upstream.mockResolvedValue(ok(DELIVERED));
    const get = tracker();
    await get(NO);
    clock += 24 * 60 * MIN;
    expect((await get(NO)).meta).toEqual(screenMeta);

    const other = "10332152871107";
    await store.upsertRegistrations([{ invoiceNo: other, meta: { productName: "다른 상품" } }], "nsv", new Date(clock));
    upstream.mockResolvedValue(notFound);
    const nf = await get(other);
    expect(nf).toMatchObject({ status: "not_found" });
    expect(nf.meta).toEqual({ productName: "다른 상품" });
  });

  it("조회 불가(unavailable)여도 등록된 번호면 meta 가 들어간다", async () => {
    await register();
    upstream.mockResolvedValue({ kind: "error", reason: "auth" });
    const result = await tracker()(NO);
    expect(result).toMatchObject({ status: "unavailable" });
    expect(result.meta).toEqual(screenMeta);
  });

  it("meta 가 없거나 화면용 필드가 없으면 meta 키 자체를 만들지 않는다 (미등록 번호는 기존 결과 그대로)", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const unregistered = await tracker()(NO);
    expect("meta" in unregistered).toBe(false);

    // 등록은 됐지만 운영용 필드만 있는 경우
    const other = "10332152871107";
    await store.upsertRegistrations([{ invoiceNo: other, meta: { orderId: "O-1", memo: "메모" } }], "nsv", new Date(clock));
    const onlyInternal = await tracker()(other);
    expect(onlyInternal.status).toBe("ok");
    expect("meta" in onlyInternal).toBe(false);
  });

  it("미등록 조회 차단·invalid 응답에는 meta 가 없다", async () => {
    const blocked = await tracker({ allowUnregisteredLookup: false })(NO);
    expect("meta" in blocked).toBe(false);
    const invalid = await tracker()("abc");
    expect("meta" in invalid).toBe(false);
  });

  it("저장소가 meta 를 못 읽어도 조회 자체는 된다 (store.get 실패)", async () => {
    const broken: InvoiceStore = {
      get: vi.fn().mockRejectedValue(new Error("db down")),
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      saveAttemptError: vi.fn().mockResolvedValue(undefined),
      saveFetchedMeta: vi.fn().mockResolvedValue(undefined),
      saveMetaNotFound: vi.fn().mockResolvedValue(undefined),
      upsertRegistrations: vi.fn(),
      listRegistered: vi.fn(),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    const result = await tracker({}, broken)(NO);
    expect(result.status).toBe("ok");
    expect("meta" in result).toBe(false);
    spy.mockRestore();
  });
});

describe("저장소 장애", () => {
  it("store 가 실패해도 업스트림 결과로 응답한다", async () => {
    const broken: InvoiceStore = {
      get: vi.fn().mockRejectedValue(new Error("db down")),
      saveSnapshot: vi.fn().mockRejectedValue(new Error("db down")),
      saveAttemptError: vi.fn().mockRejectedValue(new Error("db down")),
      saveFetchedMeta: vi.fn().mockRejectedValue(new Error("db down")),
      saveMetaNotFound: vi.fn().mockRejectedValue(new Error("db down")),
      upsertRegistrations: vi.fn(),
      listRegistered: vi.fn(),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    upstream.mockResolvedValue(ok(IN_TRANSIT));

    const result = await tracker({}, broken)(NO);
    expect(result).toMatchObject({ status: "ok", stale: false });
    spy.mockRestore();
  });
});

describe("NSV 조회(pull)로 화면용 meta 채우기", () => {
  const TTL = 600_000;
  const NEG_TTL = 120_000;
  const PULLED = {
    productName: "NSV 상품명",
    receiverName: "홍*동",
    receiverAddress: "서울 강남구 도산대로45길 *** ***동 ****호",
    deliveryMessage: "문 앞 (*********)",
  };
  const found = (meta: Partial<typeof PULLED> = PULLED): NsvMetaResult => ({ kind: "found", meta });

  let nsvFetch: ReturnType<typeof vi.fn<(no: string) => Promise<NsvMetaResult>>>;

  beforeEach(() => {
    nsvFetch = vi.fn<(no: string) => Promise<NsvMetaResult>>();
  });

  function pullTracker(storeOverride?: InvoiceStore) {
    return createTracker({
      store: storeOverride ?? store,
      fetchUpstream: upstream,
      now: () => clock,
      config: baseConfig,
      nsv: { fetchMeta: nsvFetch, ttlMs: TTL, negativeTtlMs: NEG_TTL },
    });
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("meta 가 없으면 NSV 를 조회하고 병합 저장한다 (metaFetchedAt, metaSource:nsv, registered:false 유지)", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    nsvFetch.mockResolvedValue(found());

    const result = await pullTracker()(NO);

    expect(nsvFetch).toHaveBeenCalledTimes(1);
    expect(nsvFetch).toHaveBeenCalledWith(NO);
    expect(result).toMatchObject({ status: "ok", stale: false });
    expect(result.meta).toEqual(PULLED);

    const doc = await store.get(NO);
    expect(doc).toMatchObject({ registered: false, meta: PULLED, metaSource: "nsv", snapshotKind: "ok" });
    expect(doc?.metaFetchedAt?.getTime()).toBe(clock);
    expect(doc?.metaNotFoundAt).toBeUndefined();
  });

  it("공개 결과에는 meta 4개 필드만 나가고 metaFetchedAt / metaSource / metaNotFoundAt 은 나가지 않는다", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    nsvFetch.mockResolvedValue(found());
    const result = await pullTracker()(NO);
    expect(Object.keys(result.meta ?? {}).sort()).toEqual(["deliveryMessage", "productName", "receiverAddress", "receiverName"]);
    expect(JSON.stringify(result)).not.toMatch(/metaFetchedAt|metaSource|metaNotFoundAt|"nsv"/);
  });

  it("TTL 이내면 NSV 를 다시 부르지 않고 저장된 meta 를 쓴다, TTL 이 지나면 다시 조회한다", async () => {
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    nsvFetch.mockResolvedValue(found());
    const get = pullTracker();
    await get(NO);
    expect(nsvFetch).toHaveBeenCalledTimes(1);

    clock += TTL - SEC; // 599초
    const within = await get(NO);
    expect(nsvFetch).toHaveBeenCalledTimes(1);
    expect(within.meta).toEqual(PULLED);

    nsvFetch.mockResolvedValue(found({ ...PULLED, productName: "갱신된 상품명" }));
    clock += 2 * SEC; // 601초
    const after = await get(NO);
    expect(nsvFetch).toHaveBeenCalledTimes(2);
    expect(after.meta).toEqual({ ...PULLED, productName: "갱신된 상품명" });
    expect((await store.get(NO))?.metaFetchedAt?.getTime()).toBe(clock);
  });

  it("push(수집 API)로 들어온 meta 도 pull 로 갱신된다 (같은 필드는 NSV 값, 안 온 필드와 운영용 필드는 유지)", async () => {
    await store.upsertRegistrations(
      [
        {
          invoiceNo: NO,
          meta: { orderId: "ORD-1", memo: "내부메모", productName: "push 상품명", receiverAddress: "push 주소 ***" },
        },
      ],
      "nsv-operator",
      new Date(clock),
    );
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    nsvFetch.mockResolvedValue(found({ productName: "pull 상품명", deliveryMessage: "문 앞 (*********)" }));

    const result = await pullTracker()(NO);
    expect(nsvFetch).toHaveBeenCalledTimes(1);
    expect(result.meta).toEqual({
      productName: "pull 상품명",
      receiverAddress: "push 주소 ***",
      deliveryMessage: "문 앞 (*********)",
    });

    const doc = await store.get(NO);
    expect(doc).toMatchObject({
      registered: true,
      operator: "nsv-operator",
      metaSource: "nsv",
      meta: { orderId: "ORD-1", memo: "내부메모", productName: "pull 상품명", receiverAddress: "push 주소 ***" },
    });
  });

  it("빈 값으로 기존 값을 덮지 않는다", async () => {
    await store.upsertRegistrations(
      [{ invoiceNo: NO, meta: { productName: "기존 상품명", receiverAddress: "기존 주소 ***" } }],
      "nsv",
      new Date(clock),
    );
    upstream.mockResolvedValue(ok(IN_TRANSIT));
    nsvFetch.mockResolvedValue({
      kind: "found",
      meta: { productName: "", receiverAddress: "  ", receiverName: "홍*동" },
    });

    const result = await pullTracker()(NO);
    expect(result.meta).toEqual({ productName: "기존 상품명", receiverAddress: "기존 주소 ***", receiverName: "홍*동" });
    expect((await store.get(NO))?.meta).toEqual({
      productName: "기존 상품명",
      receiverAddress: "기존 주소 ***",
      receiverName: "홍*동",
    });
  });

  describe("not_found 음성 캐시", () => {
    it("NSV 가 없음으로 답하면 시각을 기록하고, NEGATIVE_TTL 동안은 다시 부르지 않는다", async () => {
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue({ kind: "not_found" });
      const get = pullTracker();

      const first = await get(NO);
      expect(first.status).toBe("ok");
      expect("meta" in first).toBe(false);
      const doc = await store.get(NO);
      expect(doc?.metaNotFoundAt?.getTime()).toBe(clock);
      expect(doc?.metaFetchedAt).toBeUndefined();
      expect(doc?.meta).toBeUndefined();

      clock += NEG_TTL - SEC; // 119초
      await get(NO);
      expect(nsvFetch).toHaveBeenCalledTimes(1);

      clock += 2 * SEC; // 121초
      await get(NO);
      expect(nsvFetch).toHaveBeenCalledTimes(2);
    });

    it("기존 meta 가 있어도 not_found 로 지우지 않는다", async () => {
      await store.upsertRegistrations([{ invoiceNo: NO, meta: { productName: "push 상품명" } }], "nsv", new Date(clock));
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue({ kind: "not_found" });

      const result = await pullTracker()(NO);
      expect(result.meta).toEqual({ productName: "push 상품명" });
      expect((await store.get(NO))?.meta).toEqual({ productName: "push 상품명" });
    });

    it("음성 캐시 기간이 지난 뒤 found 가 되면 meta 를 저장하고 음성 캐시는 지워진다", async () => {
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValueOnce({ kind: "not_found" });
      const get = pullTracker();
      await get(NO);

      clock += NEG_TTL + SEC;
      nsvFetch.mockResolvedValueOnce(found());
      const result = await get(NO);
      expect(result.meta).toEqual(PULLED);
      const doc = await store.get(NO);
      expect(doc?.metaNotFoundAt).toBeUndefined();
      expect(doc?.metaFetchedAt?.getTime()).toBe(clock);
    });

    it("found 인데 표시할 값이 하나도 없으면 음성 캐시로 둔다 (매 조회마다 다시 묻지 않음)", async () => {
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue({ kind: "found", meta: {} });
      const get = pullTracker();
      const first = await get(NO);
      expect("meta" in first).toBe(false);
      await get(NO);
      expect(nsvFetch).toHaveBeenCalledTimes(1);
      const doc = await store.get(NO);
      expect(doc?.metaNotFoundAt?.getTime()).toBe(clock);
      expect(doc?.metaFetchedAt).toBeUndefined();
    });
  });

  describe("NSV 조회 실패", () => {
    it("error 면 기존 meta 를 그대로 쓰고 아무것도 기록하지 않으며, 다음 조회에서 바로 다시 시도한다", async () => {
      await store.upsertRegistrations([{ invoiceNo: NO, meta: { productName: "push 상품명" } }], "nsv", new Date(clock));
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue({ kind: "error", reason: "timeout" });
      const get = pullTracker();

      const result = await get(NO);
      expect(result).toMatchObject({ status: "ok", stale: false });
      expect(result.meta).toEqual({ productName: "push 상품명" });
      const doc = await store.get(NO);
      expect(doc?.meta).toEqual({ productName: "push 상품명" });
      expect(doc?.metaFetchedAt).toBeUndefined();
      expect(doc?.metaNotFoundAt).toBeUndefined();

      await get(NO);
      expect(nsvFetch).toHaveBeenCalledTimes(2);
    });

    it("error 면 meta 가 없어도 배송 조회 결과는 정상이고 meta 키가 없다", async () => {
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue({ kind: "error", reason: "schema_mismatch" });
      const result = await pullTracker()(NO);
      expect(result).toMatchObject({ status: "ok", stale: false, invoiceNo: NO });
      expect(result.data?.currentStep).toBe("이동");
      expect("meta" in result).toBe(false);
      expect(await store.get(NO)).toMatchObject({ snapshotKind: "ok" });
    });

    it("fetchMeta 가 예외를 던져도 배송 조회 결과는 정상이다", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockRejectedValue(new Error("boom"));
      const result = await pullTracker()(NO);
      expect(result).toMatchObject({ status: "ok", stale: false });
      expect("meta" in result).toBe(false);
      spy.mockRestore();
    });

    it("disabled(NSV_GRAPHQL_URLS 없음)면 아무것도 저장하지 않고 저장소 meta 만 쓴다", async () => {
      await store.upsertRegistrations([{ invoiceNo: NO, meta: { productName: "push 상품명" } }], "nsv", new Date(clock));
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue({ kind: "disabled" });
      const result = await pullTracker()(NO);
      expect(result.meta).toEqual({ productName: "push 상품명" });
      const doc = await store.get(NO);
      expect(doc?.metaFetchedAt).toBeUndefined();
      expect(doc?.metaNotFoundAt).toBeUndefined();
    });

    it("nsv 설정이 없으면(deps.nsv 미지정) NSV 를 전혀 부르지 않는다", async () => {
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      const result = await tracker()(NO);
      expect(result.status).toBe("ok");
      expect(nsvFetch).not.toHaveBeenCalled();
    });

    it("meta 저장이 실패해도 응답에는 방금 받은 NSV 값이 들어간다", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const flaky = new MemoryInvoiceStore();
      flaky.saveFetchedMeta = vi.fn().mockRejectedValue(new Error("db down"));
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue(found());
      const result = await pullTracker(flaky)(NO);
      expect(result).toMatchObject({ status: "ok" });
      expect(result.meta).toEqual(PULLED);
      spy.mockRestore();
    });
  });

  describe("Delivery Tracker 와의 관계", () => {
    it("Delivery Tracker 와 NSV 를 병렬로 호출한다 (한쪽이 끝나기 전에 둘 다 호출됨)", async () => {
      let releaseUpstream!: (value: UpstreamResult) => void;
      let releaseNsv!: (value: NsvMetaResult) => void;
      upstream.mockImplementation(() => new Promise<UpstreamResult>((resolve) => (releaseUpstream = resolve)));
      nsvFetch.mockImplementation(() => new Promise<NsvMetaResult>((resolve) => (releaseNsv = resolve)));

      const pending = pullTracker()(NO);
      await flush();
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(nsvFetch).toHaveBeenCalledTimes(1);

      releaseUpstream(ok(IN_TRANSIT));
      await flush();
      let settled = false;
      void pending.then(() => (settled = true));
      await flush();
      expect(settled).toBe(false); // NSV 응답을 기다린다

      releaseNsv(found());
      const result = await pending;
      expect(result).toMatchObject({ status: "ok" });
      expect(result.meta).toEqual(PULLED);
    });

    it("NSV 가 느려도 배송 조회는 이미 시작돼 있다 (NSV 를 먼저 끝까지 기다리지 않는다)", async () => {
      nsvFetch.mockImplementation(() => new Promise<NsvMetaResult>(() => undefined)); // 끝나지 않음
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      void pullTracker()(NO);
      await flush();
      expect(upstream).toHaveBeenCalledTimes(1);
    });

    it("배송 스냅샷 캐시 히트여도 meta 가 필요하면 NSV 만 조회한다", async () => {
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValueOnce({ kind: "error", reason: "network" });
      const get = pullTracker();
      const first = await get(NO);
      expect("meta" in first).toBe(false);

      clock += 30 * SEC; // 스냅샷 TTL(120초) 이내 -> 업스트림은 캐시
      nsvFetch.mockResolvedValueOnce(found());
      const second = await get(NO);
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(nsvFetch).toHaveBeenCalledTimes(2);
      expect(second.fetchedAt).toBe(first.fetchedAt);
      expect(second.meta).toEqual(PULLED);
    });

    it("업스트림이 not_found / 조회 실패여도 NSV meta 는 붙는다", async () => {
      nsvFetch.mockResolvedValue(found());

      upstream.mockResolvedValueOnce(notFound);
      const nf = await pullTracker()(NO);
      expect(nf).toMatchObject({ status: "not_found" });
      expect(nf.meta).toEqual(PULLED);

      upstream.mockResolvedValueOnce({ kind: "error", reason: "timeout" });
      const un = await pullTracker()("10332152871107");
      expect(un).toMatchObject({ status: "unavailable" });
      expect(un.meta).toEqual(PULLED);
    });

    it("미등록(registered:false) 번호도 NSV 를 조회한다", async () => {
      expect(await store.get(NO)).toBeNull();
      upstream.mockResolvedValue(ok(IN_TRANSIT));
      nsvFetch.mockResolvedValue(found());
      const result = await pullTracker()(NO);
      expect(nsvFetch).toHaveBeenCalledWith(NO);
      expect(result.meta).toEqual(PULLED);
      expect((await store.get(NO))?.registered).toBe(false);
    });

    it("ALLOW_UNREGISTERED_LOOKUP=false 로 차단된 번호와 잘못된 번호는 NSV 도 부르지 않는다", async () => {
      const blocked = createTracker({
        store,
        fetchUpstream: upstream,
        now: () => clock,
        config: { ...baseConfig, allowUnregisteredLookup: false },
        nsv: { fetchMeta: nsvFetch, ttlMs: TTL, negativeTtlMs: NEG_TTL },
      });
      expect(await blocked(NO)).toMatchObject({ status: "not_found", reason: "unregistered_lookup_disabled" });
      expect(await pullTracker()("abc")).toMatchObject({ status: "invalid" });
      expect(nsvFetch).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    });
  });
});

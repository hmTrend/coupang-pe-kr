import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTrackingData } from "@/lib/deliveryTracker/__fixtures__/load";
import type { TrackingData, UpstreamResult } from "@/lib/deliveryTracker/types";
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

describe("저장소 장애", () => {
  it("store 가 실패해도 업스트림 결과로 응답한다", async () => {
    const broken: InvoiceStore = {
      get: vi.fn().mockRejectedValue(new Error("db down")),
      saveSnapshot: vi.fn().mockRejectedValue(new Error("db down")),
      saveAttemptError: vi.fn().mockRejectedValue(new Error("db down")),
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

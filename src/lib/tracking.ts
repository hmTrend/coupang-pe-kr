// 운송장 조회 오케스트레이션: 캐시 정책 + 업스트림(Delivery Tracker) 호출 + 스냅샷 저장
import { trackingConfig, type TrackingConfig } from "@/lib/config";
import { fetchTrack } from "@/lib/deliveryTracker/client";
import type { TrackingData, UpstreamErrorReason, UpstreamResult } from "@/lib/deliveryTracker/types";
import { normalizeInvoiceNo } from "@/lib/invoiceNo";
import { getStore } from "@/lib/store";
import type { InvoiceDoc, InvoiceStore } from "@/lib/store/types";

export interface NotFoundInfo {
  title: string;
  message: string;
}

export interface TrackingResult {
  status: "ok" | "not_found" | "unavailable" | "invalid";
  invoiceNo: string;
  data?: TrackingData;
  notFound?: NotFoundInfo;
  /** 이 정보를 업스트림에서 가져온(=스냅샷을 저장한) 시각, ISO 문자열 */
  fetchedAt?: string;
  /** 실시간 조회에 실패해 이전 스냅샷을 대신 보여주는 중 */
  stale: boolean;
  /**
   * 실패/제한 사유 (stale, unavailable, not_found(미등록 차단) 일 때). 공개 API 로도 나가므로 일반화된 값만 쓴다:
   * "not_configured" | "upstream_unavailable" | "unregistered_lookup_disabled" | "invalid_invoice_no"
   */
  reason?: string;
}

export interface TrackingOptions {
  forceRefresh?: boolean;
}

export interface TrackingDeps {
  store: InvoiceStore;
  fetchUpstream: (invoiceNo: string) => Promise<UpstreamResult>;
  /** 현재 시각 (epoch ms). 테스트에서 주입 */
  now: () => number;
  config: TrackingConfig;
}

export const DEFAULT_NOT_FOUND: NotFoundInfo = {
  title: "검색결과가 없습니다.",
  message: "운송장 미등록 상태이거나 업체에서 상품을 준비중입니다.",
};

function fromSnapshot(doc: InvoiceDoc, stale: boolean, reason?: string): TrackingResult | null {
  if (!doc.snapshotAt) return null;
  const fetchedAt = doc.snapshotAt.toISOString();
  if (doc.snapshotKind === "ok" && doc.snapshot) {
    return { status: "ok", invoiceNo: doc._id, data: doc.snapshot, fetchedAt, stale, reason };
  }
  if (doc.snapshotKind === "not_found") {
    return {
      status: "not_found",
      invoiceNo: doc._id,
      notFound: doc.notFound ?? DEFAULT_NOT_FOUND,
      fetchedAt,
      stale,
      reason,
    };
  }
  return null;
}

/** 스냅샷이 아직 유효(업스트림 재조회 불필요)한지 판단 */
function isFresh(doc: InvoiceDoc, ageMs: number, force: boolean, cfg: TrackingConfig): boolean {
  if (doc.snapshotKind === "ok" && doc.delivered) {
    // 배송완료는 최종 상태: 재조회하지 않는다. forceRefresh 도 1시간 이내면 무시.
    return !force || ageMs < cfg.deliveredRecheckMs;
  }
  const ttl = doc.snapshotKind === "ok" ? cfg.cacheTtlMs : cfg.notFoundTtlMs;
  if (ageMs >= ttl) return false;
  // forceRefresh 는 스냅샷이 MIN_FORCE_REFRESH_MS 보다 오래됐을 때만 반영
  if (force && ageMs >= cfg.minForceRefreshMs) return false;
  return true;
}

/** 고객 화면·공개 API 에 내보내는 사유. 내부 사유(인증 실패, 호출 제한 등)는 구분하지 않는다 */
function publicReason(reason: UpstreamErrorReason): string {
  return reason === "not_configured" ? "not_configured" : "upstream_unavailable";
}

export function createTracker(deps: TrackingDeps) {
  const { store, fetchUpstream, now, config } = deps;

  // 저장소 장애가 조회 자체를 막지 않도록 한다 (캐시 없이 업스트림 결과만으로도 응답)
  async function safeGet(invoiceNo: string): Promise<InvoiceDoc | null> {
    try {
      return await store.get(invoiceNo);
    } catch (error) {
      console.error("[tracking] store.get 실패:", error);
      return null;
    }
  }

  async function safeWrite(label: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      console.error(`[tracking] ${label} 실패:`, error);
    }
  }

  return async function getTracking(
    invoiceNoInput: string,
    options: TrackingOptions = {},
  ): Promise<TrackingResult> {
    const invoiceNo = normalizeInvoiceNo(invoiceNoInput);
    if (!invoiceNo) {
      return {
        status: "invalid",
        invoiceNo: String(invoiceNoInput ?? "").slice(0, 40),
        stale: false,
        reason: "invalid_invoice_no",
      };
    }

    const force = options.forceRefresh === true;
    const doc = await safeGet(invoiceNo);

    // 미등록 번호 조회를 막는 설정이면 업스트림을 부르지 않고 "결과 없음"으로 응답
    if (!config.allowUnregisteredLookup && !doc?.registered) {
      return {
        status: "not_found",
        invoiceNo,
        notFound: DEFAULT_NOT_FOUND,
        stale: false,
        reason: "unregistered_lookup_disabled",
      };
    }

    if (doc?.snapshotAt) {
      const age = now() - doc.snapshotAt.getTime();
      if (isFresh(doc, age, force, config)) {
        const cached = fromSnapshot(doc, false);
        if (cached) return cached;
      }
    }

    const upstream = await fetchUpstream(invoiceNo);
    const nowMs = now();
    const nowDate = new Date(nowMs);

    if (upstream.kind === "ok") {
      await safeWrite("saveSnapshot", () =>
        store.saveSnapshot(invoiceNo, { kind: "ok", data: upstream.data }, nowDate),
      );
      return {
        status: "ok",
        invoiceNo,
        data: upstream.data,
        fetchedAt: nowDate.toISOString(),
        stale: false,
      };
    }

    if (upstream.kind === "not_found") {
      await safeWrite("saveSnapshot", () =>
        store.saveSnapshot(
          invoiceNo,
          { kind: "not_found", title: DEFAULT_NOT_FOUND.title, message: DEFAULT_NOT_FOUND.message },
          nowDate,
        ),
      );
      return {
        status: "not_found",
        invoiceNo,
        notFound: DEFAULT_NOT_FOUND,
        fetchedAt: nowDate.toISOString(),
        stale: false,
      };
    }

    // 조회 실패: 이전 스냅샷은 덮지 않고 시도 기록만 남긴다 (저장소에는 내부 사유, 응답에는 일반화한 사유)
    await safeWrite("saveAttemptError", () =>
      store.saveAttemptError(invoiceNo, `error:${upstream.reason}`, nowDate),
    );

    const reason = publicReason(upstream.reason);
    if (doc) {
      const stale = fromSnapshot(doc, true, reason);
      if (stale) return stale;
    }
    return { status: "unavailable", invoiceNo, stale: false, reason };
  };
}

/** 운송장 1건의 배송 정보를 가져온다 (캐시 우선, 필요 시 업스트림 실시간 조회) */
export function getTracking(
  invoiceNo: string,
  options: TrackingOptions = {},
): Promise<TrackingResult> {
  return createTracker({
    store: getStore(),
    fetchUpstream: fetchTrack,
    now: () => Date.now(),
    config: trackingConfig(),
  })(invoiceNo, options);
}

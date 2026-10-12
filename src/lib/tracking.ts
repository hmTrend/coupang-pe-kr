// 운송장 조회 오케스트레이션: 캐시 정책 + 업스트림(Delivery Tracker) 호출 + 스냅샷 저장 + NSV meta 조회(pull)/저장
import { nsvMetaPolicy, trackingConfig, type NsvMetaPolicy, type TrackingConfig } from "@/lib/config";
import { fetchTrack } from "@/lib/deliveryTracker/client";
import type { TrackingData, UpstreamErrorReason, UpstreamResult } from "@/lib/deliveryTracker/types";
import { normalizeInvoiceNo } from "@/lib/invoiceNo";
import { fetchNsvInvoiceMeta, type NsvMetaResult } from "@/lib/nsv/client";
import { getStore } from "@/lib/store";
import type { InvoiceDoc, InvoiceMeta, InvoiceStore } from "@/lib/store/types";

export interface NotFoundInfo {
  title: string;
  message: string;
}

/**
 * 고객 화면·공개 API 로 나가는 등록 정보. 저장소 meta 중 이 4개만 내보낸다
 * (orderId / memo / orderedAt / operator 는 운영용이라 담지 않는다).
 */
export interface TrackingMeta {
  /** 노출상품명(옵션명) */
  productName?: string;
  /** 마스킹된 수취인 주소 */
  receiverAddress?: string;
  /** 마스킹된 배송요청사항 */
  deliveryMessage?: string;
  /** Delivery Tracker 수령인 이름이 없을 때 대신 쓰는 이름 */
  receiverName?: string;
}

export interface TrackingResult {
  status: "ok" | "not_found" | "unavailable" | "invalid";
  invoiceNo: string;
  /** 수집 API 로 등록된 번호의 화면용 정보. 값이 하나도 없으면 필드 자체가 없다 */
  meta?: TrackingMeta;
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

/** NSV GraphQL 조회(pull)로 화면용 meta 를 채우는 설정. 없으면 저장소에 있는 meta 만 쓴다 */
export interface NsvPullDeps extends NsvMetaPolicy {
  fetchMeta: (invoiceNo: string) => Promise<NsvMetaResult>;
}

export interface TrackingDeps {
  store: InvoiceStore;
  fetchUpstream: (invoiceNo: string) => Promise<UpstreamResult>;
  /** 현재 시각 (epoch ms). 테스트에서 주입 */
  now: () => number;
  config: TrackingConfig;
  nsv?: NsvPullDeps;
}

export const DEFAULT_NOT_FOUND: NotFoundInfo = {
  title: "검색결과가 없습니다.",
  message: "운송장 미등록 상태이거나 업체에서 상품을 준비중입니다.",
};

const PUBLIC_META_FIELDS = ["productName", "receiverAddress", "deliveryMessage", "receiverName"] as const;

/** 저장소 meta 에서 화면에 내보낼 필드만 골라낸다. 하나도 없으면 undefined */
function publicMeta(meta: InvoiceMeta | undefined): TrackingMeta | undefined {
  if (!meta) return undefined;
  const out: TrackingMeta = {};
  for (const field of PUBLIC_META_FIELDS) {
    const value = meta[field];
    if (typeof value === "string" && value.trim() !== "") out[field] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** NSV pull 이 필요한가: 음성 캐시 기간이면 아니오, 표시용 meta 가 있고 metaFetchedAt 이 TTL 이내여도 아니오. 그 밖에는 예 */
function needsNsvPull(doc: InvoiceDoc | null, nowMs: number, policy: NsvMetaPolicy): boolean {
  if (doc?.metaNotFoundAt && nowMs - doc.metaNotFoundAt.getTime() < policy.negativeTtlMs) return false;
  // push(수집 API)로만 들어온 meta 는 metaFetchedAt 이 없으므로 첫 조회에서 pull 로 갱신된다
  if (publicMeta(doc?.meta) && doc?.metaFetchedAt && nowMs - doc.metaFetchedAt.getTime() < policy.ttlMs) return false;
  return true;
}

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

/** 값이 있는(빈 문자열이 아닌) 필드만 남긴다. NSV 가 빈 값을 보내도 저장소의 기존 값을 덮지 않게 한다 */
function nonBlankMeta(meta: InvoiceMeta): InvoiceMeta {
  const out: InvoiceMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string" && value.trim() !== "") (out as Record<string, string>)[key] = value;
  }
  return out;
}

export function createTracker(deps: TrackingDeps) {
  const { store, fetchUpstream, now, config, nsv } = deps;

  // NSV 조회 실패가 화면 오류로 이어지지 않게 한다 (예외는 로그만 남기고 "결과 없음"으로 취급)
  async function pullMeta(
    fetchMeta: NsvPullDeps["fetchMeta"],
    invoiceNo: string,
  ): Promise<NsvMetaResult | null> {
    try {
      return await fetchMeta(invoiceNo);
    } catch (error) {
      console.error("[tracking] NSV meta 조회 실패:", error);
      return null;
    }
  }

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

    // NSV 에서 화면용 meta 를 직접 조회(pull)한다. 미등록 번호도 대상이다(pull 의 목적).
    // Delivery Tracker 조회와 병렬로 시작해 지연을 줄인다 (캐시 히트면 이 조회만 기다린다). 이 promise 는 reject 되지 않는다
    const pull = nsv && needsNsvPull(doc, now(), nsv) ? pullMeta(nsv.fetchMeta, invoiceNo) : null;

    // NSV 조회 결과를 저장소에 반영하고 응답에 쓸 meta 를 정한다 (응답당 1회). 실패·미설정이면 저장소에 있던 meta 를 그대로 쓴다
    let settledMeta: Promise<TrackingMeta | undefined> | undefined;
    const settleMeta = () =>
      (settledMeta ??= (async (): Promise<TrackingMeta | undefined> => {
        const stored = publicMeta(doc?.meta);
        const outcome = await pull;
        if (outcome?.kind === "found") {
          const incoming = nonBlankMeta(outcome.meta);
          if (publicMeta(incoming)) {
            // 값이 있는 필드만 병합 저장 (빈 값으로 기존 값을 덮지 않음)
            await safeWrite("saveFetchedMeta", () => store.saveFetchedMeta(invoiceNo, incoming, new Date(now())));
            return publicMeta({ ...doc?.meta, ...incoming });
          }
        }
        // 표시할 값이 하나도 없는 found 도 음성 캐시로 둔다 (같은 번호를 매 조회마다 다시 묻지 않게)
        if (outcome?.kind === "found" || outcome?.kind === "not_found") {
          await safeWrite("saveMetaNotFound", () => store.saveMetaNotFound(invoiceNo, new Date(now())));
        }
        return stored;
      })());

    // 캐시/업스트림/stale 어느 경로로 응답하든 저장소 문서(또는 방금 NSV 에서 받은)의 최신 meta 를 붙인다
    const withMeta = async (result: TrackingResult): Promise<TrackingResult> => {
      const meta = await settleMeta();
      return meta ? { ...result, meta } : result;
    };

    if (doc?.snapshotAt) {
      const age = now() - doc.snapshotAt.getTime();
      if (isFresh(doc, age, force, config)) {
        const cached = fromSnapshot(doc, false);
        if (cached) return withMeta(cached);
      }
    }

    const [upstream] = await Promise.all([fetchUpstream(invoiceNo), pull]);
    const nowMs = now();
    const nowDate = new Date(nowMs);

    if (upstream.kind === "ok") {
      await safeWrite("saveSnapshot", () =>
        store.saveSnapshot(invoiceNo, { kind: "ok", data: upstream.data }, nowDate),
      );
      return withMeta({
        status: "ok",
        invoiceNo,
        data: upstream.data,
        fetchedAt: nowDate.toISOString(),
        stale: false,
      });
    }

    if (upstream.kind === "not_found") {
      await safeWrite("saveSnapshot", () =>
        store.saveSnapshot(
          invoiceNo,
          { kind: "not_found", title: DEFAULT_NOT_FOUND.title, message: DEFAULT_NOT_FOUND.message },
          nowDate,
        ),
      );
      return withMeta({
        status: "not_found",
        invoiceNo,
        notFound: DEFAULT_NOT_FOUND,
        fetchedAt: nowDate.toISOString(),
        stale: false,
      });
    }

    // 조회 실패: 이전 스냅샷은 덮지 않고 시도 기록만 남긴다 (저장소에는 내부 사유, 응답에는 일반화한 사유)
    await safeWrite("saveAttemptError", () =>
      store.saveAttemptError(invoiceNo, `error:${upstream.reason}`, nowDate),
    );

    const reason = publicReason(upstream.reason);
    if (doc) {
      const stale = fromSnapshot(doc, true, reason);
      if (stale) return withMeta(stale);
    }
    return withMeta({ status: "unavailable", invoiceNo, stale: false, reason });
  };
}

/** 운송장 1건의 배송 정보를 가져온다 (캐시 우선, 필요 시 업스트림 실시간 조회, NSV_GRAPHQL_URLS 가 있으면 화면용 meta 도 NSV 에서 조회) */
export function getTracking(
  invoiceNo: string,
  options: TrackingOptions = {},
): Promise<TrackingResult> {
  return createTracker({
    store: getStore(),
    fetchUpstream: fetchTrack,
    now: () => Date.now(),
    config: trackingConfig(),
    nsv: { fetchMeta: fetchNsvInvoiceMeta, ...nsvMetaPolicy() },
  })(invoiceNo, options);
}

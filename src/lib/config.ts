// 환경변수 읽기 헬퍼. 호출 시점에 process.env 를 읽어 테스트에서 stubEnv 가 먹히게 한다.

function intEnv(name: string, def: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return def;
  return Math.floor(n);
}

function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return def;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return def;
}

/** 사이트명 (NEXT_PUBLIC_* 는 빌드 시점에 인라인되므로 직접 참조해야 한다) */
export function siteName(): string {
  return process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "배송조회";
}

export function siteUrl(): string | undefined {
  const v = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return v ? v : undefined;
}

/** 쿠팡 파트너스 기본 링크 (NEXT_PUBLIC_COUPANG_PARTNERS_URL 이 없거나 http(s) 주소가 아니면 이 값을 쓴다) */
export const DEFAULT_COUPANG_PARTNERS_URL = "https://link.coupang.com/a/bQkvJ5";

/** 쿠팡 홈 바로가기 배너 링크. NEXT_PUBLIC_* 는 빌드 시점에 인라인되므로 직접 참조해야 한다 */
export function coupangPartnersUrl(): string {
  const v = process.env.NEXT_PUBLIC_COUPANG_PARTNERS_URL?.trim();
  return v && /^https?:\/\//i.test(v) ? v : DEFAULT_COUPANG_PARTNERS_URL;
}

export interface TrackingConfig {
  /** ok 스냅샷 신선 기간 */
  cacheTtlMs: number;
  /** not_found 스냅샷 신선 기간 */
  notFoundTtlMs: number;
  /** forceRefresh 를 반영하려면 스냅샷이 이보다 오래돼야 함 */
  minForceRefreshMs: number;
  /** 배송완료 스냅샷은 forceRefresh 여도 이 기간 안에는 재조회하지 않음 */
  deliveredRecheckMs: number;
  allowUnregisteredLookup: boolean;
}

export function trackingConfig(): TrackingConfig {
  return {
    cacheTtlMs: intEnv("CACHE_TTL_MS", 120_000),
    notFoundTtlMs: intEnv("NOT_FOUND_TTL_MS", 60_000),
    minForceRefreshMs: intEnv("MIN_FORCE_REFRESH_MS", 30_000),
    deliveredRecheckMs: intEnv("DELIVERED_RECHECK_MS", 3_600_000),
    allowUnregisteredLookup: boolEnv("ALLOW_UNREGISTERED_LOOKUP", true),
  };
}

export interface DeliveryTrackerConfig {
  /** Client Id. 공개해도 되는 값 (Tracking Link 에 쓴다) */
  clientId?: string;
  /** Client Secret. 서버에서만 읽고 로그/화면/응답/URL 에 절대 노출하지 않는다 */
  clientSecret?: string;
  /** 택배사 ID (기본 kr.coupangls) */
  carrierId: string;
  /** GraphQL 엔드포인트 (테스트용 override) */
  endpoint: string;
  /** 요청 1회 타임아웃 (공식 권장 최대 15초) */
  timeoutMs: number;
}

/** 쿠팡 로지스틱스(coupangls) 택배사 ID */
export const COUPANGLS_CARRIER_ID = "kr.coupangls";
export const DEFAULT_TRACKER_ENDPOINT = "https://apis.tracker.delivery/graphql";

function optionalEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function deliveryTrackerConfig(): DeliveryTrackerConfig {
  return {
    clientId: optionalEnv("DELIVERY_TRACKER_CLIENT_ID"),
    clientSecret: optionalEnv("DELIVERY_TRACKER_CLIENT_SECRET"),
    carrierId: optionalEnv("DELIVERY_TRACKER_CARRIER_ID") ?? COUPANGLS_CARRIER_ID,
    endpoint: optionalEnv("DELIVERY_TRACKER_ENDPOINT") ?? DEFAULT_TRACKER_ENDPOINT,
    timeoutMs: intEnv("DELIVERY_TRACKER_TIMEOUT_MS", 15_000, 1),
  };
}

export interface NsvConfig {
  /** NSV_GRAPHQL_URLS 원문 (쉼표·공백·줄바꿈 구분). 파싱·검증은 nsv/client 에서 한다. 비어 있으면 NSV 조회 기능이 꺼진다 */
  graphqlUrls: string | undefined;
  /** 엔드포인트 1곳당 타임아웃 */
  timeoutMs: number;
}

export function nsvConfig(): NsvConfig {
  return {
    graphqlUrls: optionalEnv("NSV_GRAPHQL_URLS"),
    timeoutMs: intEnv("NSV_GRAPHQL_TIMEOUT_MS", 3_000, 1),
  };
}

/** NSV 에서 받아온 meta 를 다시 조회하지 않는 기간 */
export interface NsvMetaPolicy {
  /** 받아온 meta 가 신선한 기간. 지나면 다시 조회해 갱신한다 (push 로 들어온 meta 포함) */
  ttlMs: number;
  /** NSV 가 "없음"으로 답한 번호를 다시 묻지 않는 기간 (음성 캐시) */
  negativeTtlMs: number;
}

export function nsvMetaPolicy(): NsvMetaPolicy {
  return {
    ttlMs: intEnv("NSV_META_TTL_MS", 600_000),
    negativeTtlMs: intEnv("NSV_META_NEGATIVE_TTL_MS", 120_000),
  };
}

export function mongoConfig(): { uri: string | undefined; db: string } {
  const uri = process.env.MONGODB_URI?.trim();
  return {
    uri: uri ? uri : undefined,
    db: process.env.MONGODB_DB?.trim() || "coupang_pe_kr",
  };
}

export function apiRateLimitPerMin(): number {
  return intEnv("API_RATE_LIMIT_PER_MIN", 30, 1);
}

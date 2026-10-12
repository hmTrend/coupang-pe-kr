// Delivery Tracker(tracker.delivery) Tracking API 호출 클라이언트 (GraphQL)
//
// 반드시 서버(Next 서버 컴포넌트/route)에서만 쓴다. Client Secret 이 매 요청의 Authorization 헤더에 실리므로
// 브라우저 번들에 들어가면 누구나 키를 복사해 쿼터를 소진시킬 수 있다. (환경변수에 NEXT_PUBLIC_ 를 붙이지 말 것)
//
// 쿼터 보호와 안정성:
//  - 같은 운송장 동시 요청은 API 호출 1회로 합친다 (in-flight dedup)
//  - 호출 제한(HTTP 429 등)을 받으면 일정 시간 전역으로 API 를 부르지 않는다 (그동안은 캐시/stale 만)
//  - 요청 1회 타임아웃은 공식 권장 최대 15초
// 응답 본문과 자격증명은 로그에 남기지 않는다. 실패 로그에는 사유·상태코드·에러 코드·(자격증명을 가린) 짧은 메시지만 남긴다.
//
// 상태(in-flight, 백오프)는 프로세스 메모리에 둔다 (단일 인스턴스 전제).
import { deliveryTrackerConfig, type DeliveryTrackerConfig } from "@/lib/config";
import { mapTrackInfo } from "./map";
import type { ApiTrackInfo, UpstreamErrorReason, UpstreamResult } from "./types";

export const TRACK_QUERY = `query Track($carrierId: ID!, $trackingNumber: String!) {
  track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
    trackingNumber
    lastEvent { time status { code name } description location { name } }
    events(last: 100) { edges { node { time status { code name } description location { name } } } }
    recipient { name location { name } }
  }
}`;

/** 호출 제한을 받은 뒤 API 를 다시 부르기까지 기다리는 시간 */
export const RATE_LIMIT_BACKOFF_MS = 30_000;
/** 응답 본문 상한 (비정상적으로 큰 응답 방어) */
const MAX_BODY_CHARS = 1_000_000;
const MAX_LOG_MESSAGE = 200;

const AUTH_CODES = new Set(["FORBIDDEN", "UNAUTHENTICATED", "UNAUTHORIZED"]);
const RATE_LIMIT_CODES = new Set(["RATE_LIMITED", "RATE_LIMIT_EXCEEDED", "TOO_MANY_REQUESTS", "THROTTLED", "QUOTA_EXCEEDED"]);
const BAD_REQUEST_CODES = new Set(["BAD_REQUEST", "BAD_USER_INPUT", "GRAPHQL_VALIDATION_FAILED", "GRAPHQL_PARSE_FAILED"]);

interface GraphqlError {
  code?: string;
  message?: string;
}

export interface DeliveryTrackerClientOptions {
  /** 호출 시점에 설정을 읽는다 (기본: 환경변수) */
  getConfig?: () => DeliveryTrackerConfig;
  /** 테스트에서 주입. 기본은 호출 시점의 전역 fetch (Next 의 fetch 캐시가 끼지 않게 cache: "no-store" 로 보낸다) */
  fetchImpl?: typeof fetch;
  /** 현재 시각 (epoch ms). 테스트에서 주입 */
  now?: () => number;
  /** 경고 로그 출력 (기본 console.warn) */
  log?: (message: string) => void;
  rateLimitBackoffMs?: number;
}

function toGraphqlErrors(body: unknown): GraphqlError[] {
  const raw = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const e = entry as { message?: unknown; extensions?: { code?: unknown } } | null;
    const code = e?.extensions?.code;
    return {
      code: typeof code === "string" ? code.toUpperCase() : undefined,
      message: typeof e?.message === "string" ? e.message : undefined,
    };
  });
}

function isRateLimitError(error: GraphqlError): boolean {
  if (error.code && RATE_LIMIT_CODES.has(error.code)) return true;
  return !!error.message && /rate.?limit|too many requests|quota/i.test(error.message);
}

export class DeliveryTrackerClient {
  private readonly getConfig: () => DeliveryTrackerConfig;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly backoffMs: number;

  private readonly inflight = new Map<string, Promise<UpstreamResult>>();
  private backoffUntil = 0;
  private warnedNotConfigured = false;

  constructor(options: DeliveryTrackerClientOptions = {}) {
    this.getConfig = options.getConfig ?? deliveryTrackerConfig;
    this.fetchImpl = options.fetchImpl;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? ((message) => console.warn(message));
    this.backoffMs = options.rateLimitBackoffMs ?? RATE_LIMIT_BACKOFF_MS;
  }

  /** 운송장 1건 조회. 같은 번호의 동시 호출은 하나로 합친다. 예외를 던지지 않는다 */
  fetchTrack(invoiceNo: string): Promise<UpstreamResult> {
    const existing = this.inflight.get(invoiceNo);
    if (existing) return existing;
    const promise = this.run(invoiceNo).finally(() => this.inflight.delete(invoiceNo));
    this.inflight.set(invoiceNo, promise);
    return promise;
  }

  private async run(invoiceNo: string): Promise<UpstreamResult> {
    const cfg = this.getConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.log(
          "[deliveryTracker] DELIVERY_TRACKER_CLIENT_ID / DELIVERY_TRACKER_CLIENT_SECRET 가 설정되지 않아 배송 조회를 할 수 없습니다.",
        );
      }
      return { kind: "error", reason: "not_configured" };
    }

    // 호출 제한 백오프 중에는 API 를 부르지 않는다
    if (this.now() < this.backoffUntil) return { kind: "error", reason: "rate_limited" };

    const result = await this.request(invoiceNo, cfg, cfg.clientId, cfg.clientSecret);
    if (result.kind === "error" && result.reason === "rate_limited") {
      this.backoffUntil = this.now() + this.backoffMs;
    }
    return result;
  }

  private async request(
    invoiceNo: string,
    cfg: DeliveryTrackerConfig,
    clientId: string,
    clientSecret: string,
  ): Promise<UpstreamResult> {
    const fail = (reason: UpstreamErrorReason, detail: { status?: number; code?: string; message?: string } = {}) => {
      this.logFailure(reason, detail, clientSecret);
      return { kind: "error", reason } satisfies UpstreamResult;
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let status: number;
    let text: string;
    try {
      const res = await (this.fetchImpl ?? fetch)(cfg.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `TRACKQL-API-KEY ${clientId}:${clientSecret}`,
        },
        body: JSON.stringify({
          query: TRACK_QUERY,
          variables: { carrierId: cfg.carrierId, trackingNumber: invoiceNo },
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      status = res.status;
      text = await res.text();
    } catch (error) {
      if (controller.signal.aborted) return fail("timeout");
      const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
      return fail("network", {
        code: typeof cause?.code === "string" ? cause.code : undefined,
        message: error instanceof Error ? `${error.name}: ${error.message}` : undefined,
      });
    } finally {
      clearTimeout(timer);
    }

    if (status === 429) return fail("rate_limited", { status });
    if (status === 401 || status === 403) return fail("auth", { status });
    if (status >= 500) return fail("server_error", { status });
    if (text.length > MAX_BODY_CHARS) return fail("invalid_response", { status });

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(status >= 400 ? "bad_request" : "invalid_response", { status });
    }

    // 오류가 하나라도 있으면 부분 데이터가 있어도 쓰지 않는다 (빈 이력을 정상 스냅샷으로 캐시하지 않기 위함)
    const errors = toGraphqlErrors(body);
    if (errors.length > 0) {
      const first = errors[0];
      const detail = { status, code: first.code, message: first.message };
      if (errors.some((e) => e.code && AUTH_CODES.has(e.code))) return fail("auth", detail);
      if (errors.some(isRateLimitError)) return fail("rate_limited", detail);
      if (errors.some((e) => e.code === "NOT_FOUND")) return { kind: "not_found" };
      if (errors.some((e) => e.code && BAD_REQUEST_CODES.has(e.code))) return fail("bad_request", detail);
      return fail("server_error", detail);
    }
    if (status >= 400) return fail("bad_request", { status });

    const track = (body as { data?: { track?: unknown } } | null)?.data?.track;
    if (typeof track !== "object" || track === null || Array.isArray(track)) {
      return fail("invalid_response", { status });
    }
    return { kind: "ok", data: mapTrackInfo(track as ApiTrackInfo, { invoiceNo, carrierId: cfg.carrierId }) };
  }

  private logFailure(
    reason: UpstreamErrorReason,
    detail: { status?: number; code?: string; message?: string },
    secret: string,
  ): void {
    const parts = [`reason=${reason}`];
    if (detail.status !== undefined) parts.push(`http=${detail.status}`);
    if (detail.code) parts.push(`code=${detail.code}`);
    if (detail.message) {
      const message = detail.message.split(secret).join("***").replace(/\s+/g, " ").slice(0, MAX_LOG_MESSAGE);
      parts.push(`message=${message}`);
    }
    this.log(`[deliveryTracker] 조회 실패 ${parts.join(" ")}`);
  }
}

// dev 핫리로드에서도 in-flight/백오프 상태가 유지되도록 globalThis 에 둔다
const globalForClient = globalThis as unknown as { __deliveryTrackerClient?: DeliveryTrackerClient };

export function getDefaultClient(): DeliveryTrackerClient {
  const existing = globalForClient.__deliveryTrackerClient;
  // 핫리로드로 이 모듈이 다시 평가되면 클래스가 새로 만들어져 옛 인스턴스는 instanceof 를 통과하지 못한다.
  // 그때는 옛 모듈(변환 로직 포함)을 붙잡고 있는 인스턴스를 버리고 새로 만든다. 운영(HMR 없음)에서는 항상 재사용된다.
  if (existing instanceof DeliveryTrackerClient) return existing;
  return (globalForClient.__deliveryTrackerClient = new DeliveryTrackerClient());
}

/** 운송장 1건 조회 (프로세스 전역 클라이언트 사용) */
export function fetchTrack(invoiceNo: string): Promise<UpstreamResult> {
  return getDefaultClient().fetchTrack(invoiceNo);
}

/** 테스트용: 전역 클라이언트(백오프/in-flight 상태)를 초기화한다 */
export function __resetDefaultClientForTest(): void {
  globalForClient.__deliveryTrackerClient = undefined;
}

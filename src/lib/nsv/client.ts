// NSV 백엔드 GraphQL 조회(pull) 클라이언트: 운송장번호로 마스킹된 상품명·수령인·받는주소·배송요청사항을 가져온다.
//
// 업체(tenant)마다 NSV 백엔드가 따로 있어서 엔드포인트가 여러 개다(NSV_GRAPHQL_URLS). 어느 업체 번호인지 모르므로
// 모든 엔드포인트에 병렬로 물어보고, found:true 인 첫 응답(목록 순서 우선)을 쓴다.
//  - 하나라도 found      -> found
//  - 정상 응답이 있고 모두 found:false -> not_found
//  - 전부 실패(네트워크·타임아웃·GraphQL errors·비정상 응답) -> error
//  - NSV_GRAPHQL_URLS 가 없거나 유효한 주소가 하나도 없음 -> disabled (아무것도 호출하지 않는다)
// 쿼리는 NSV 쪽이 마스킹한 공개 수준 정보만 돌려주므로 인증이 없다. 그래도 받은 값은 mask.ts 로 한 번 더 가린다(멱등).
//
// 서버(Next 서버 컴포넌트/route)에서만 쓴다. 이 모듈은 예외를 던지지 않는다.
// 로그에는 엔드포인트 호스트·사유·HTTP 상태·운송장번호 뒤 4자리만 남긴다 (응답 본문, 전체 번호, 주소 값은 남기지 않는다).
//
// 상태(in-flight)는 프로세스 메모리에 둔다 (단일 인스턴스 전제).
import { nsvConfig, type NsvConfig } from "@/lib/config";
import { cleanString, FIELD_LIMITS, MASKERS } from "@/lib/ingest";
import type { InvoiceMeta } from "@/lib/store/types";

export const NSV_QUERY = `query TrackingSiteInvoice($input: GetTrackingSiteInvoiceInput!) {
  getTrackingSiteInvoice(input: $input) {
    found
    trackingNo
    productName
    receiverName
    receiverAddress
    deliveryMessage
  }
}`;

/** 응답 본문 상한 (비정상적으로 큰 응답 방어). 정상 응답은 수백 바이트다 */
const MAX_BODY_CHARS = 100_000;

/** NSV 에서 받아 화면에 쓰는 필드. 모두 재마스킹을 거친 값이고, 값이 없는 필드는 키 자체가 없다 */
export type NsvInvoiceMeta = Pick<
  InvoiceMeta,
  "productName" | "receiverName" | "receiverAddress" | "deliveryMessage"
>;

/**
 * 실패 사유 (로그용 고정 값. 응답 본문은 담지 않는다):
 * timeout · network · http_error(HTTP 5xx/4xx) · schema_mismatch(NSV 가 아직 이 쿼리를 모름 = 백엔드 재시작/배포 필요) ·
 * graphql_error(그 밖의 GraphQL errors) · invalid_response(JSON 이 아니거나 모양이 계약과 다름)
 */
export type NsvErrorReason =
  | "timeout"
  | "network"
  | "http_error"
  | "schema_mismatch"
  | "graphql_error"
  | "invalid_response";

type EndpointResult =
  | { kind: "found"; meta: NsvInvoiceMeta }
  | { kind: "not_found" }
  | { kind: "error"; reason: NsvErrorReason };

export type NsvMetaResult = EndpointResult | { kind: "disabled" };

interface Endpoint {
  /** fetch 에 넘기는 정규화된 주소 */
  url: string;
  /** 로그용 host:port (업체마다 포트가 다르다) */
  host: string;
}

/**
 * NSV_GRAPHQL_URLS 파싱: 쉼표·공백·줄바꿈으로 나누고 http(s) 주소만 남긴다. 중복은 처음 것만 둔다.
 * 형식 오류(스킴이 http/https 가 아님, 파싱 실패, 호스트 없음, 사용자:비밀번호 포함)는 건너뛰고
 * 몇 번째 항목인지(1부터)만 돌려준다 — 값 자체는 자격증명이 섞여 있을 수 있어 로그에 쓰지 않는다.
 */
export function parseNsvGraphqlUrls(raw: string | undefined): { urls: string[]; invalid: number[] } {
  const urls: string[] = [];
  const invalid: number[] = [];
  const entries = (raw ?? "").split(/[\s,]+/).filter((entry) => entry !== "");
  entries.forEach((entry, index) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      invalid.push(index + 1);
      return;
    }
    const ok = (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "" && !url.username && !url.password;
    if (!ok) {
      invalid.push(index + 1);
      return;
    }
    if (!urls.includes(url.href)) urls.push(url.href);
  });
  return { urls, invalid };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** NSV 가 이 쿼리/필드를 모르는 경우(GraphQL 검증 실패). 백엔드를 아직 재시작·배포하지 않았을 때 나온다 */
function isSchemaMismatch(errors: unknown[]): boolean {
  return errors.some((entry) => {
    if (!isRecord(entry)) return false;
    const code = isRecord(entry.extensions) ? entry.extensions.code : undefined;
    if (code === "GRAPHQL_VALIDATION_FAILED") return true;
    return typeof entry.message === "string" && /cannot query field|unknown (type|argument)/i.test(entry.message);
  });
}

/**
 * 응답 노드에서 화면용 필드만 꺼내 정리한다. 제어문자·공백 정리 -> 마스킹(주소·배송메시지·수령인) -> 길이 제한 순서로,
 * 수집 API(ingest)와 같은 규칙이다. 문자열이 아니거나 정리 후 빈 값이면 그 필드는 뺀다.
 */
function sanitizeMeta(node: Record<string, unknown>): NsvInvoiceMeta {
  const meta: NsvInvoiceMeta = {};
  for (const field of ["productName", "receiverName", "receiverAddress", "deliveryMessage"] as const) {
    const value = node[field];
    if (typeof value !== "string") continue;
    const cleaned = cleanString(value, FIELD_LIMITS[field], MASKERS[field]);
    if (cleaned !== undefined) meta[field] = cleaned;
  }
  return meta;
}

export interface NsvClientOptions {
  /** 호출 시점에 설정을 읽는다 (기본: 환경변수) */
  getConfig?: () => NsvConfig;
  /** 테스트에서 주입. 기본은 호출 시점의 전역 fetch (Next 의 fetch 캐시가 끼지 않게 cache: "no-store" 로 보낸다) */
  fetchImpl?: typeof fetch;
  /** 경고 로그 출력 (기본 console.warn) */
  log?: (message: string) => void;
}

export class NsvClient {
  private readonly getConfig: () => NsvConfig;
  private readonly fetchImpl?: typeof fetch;
  private readonly log: (message: string) => void;

  private readonly inflight = new Map<string, Promise<NsvMetaResult>>();
  /** 마지막으로 파싱한 NSV_GRAPHQL_URLS. 값이 바뀔 때만 다시 파싱하고, 형식 오류 경고도 값이 바뀔 때 1회만 낸다 */
  private parsed?: { raw: string | undefined; endpoints: Endpoint[] };

  constructor(options: NsvClientOptions = {}) {
    this.getConfig = options.getConfig ?? nsvConfig;
    this.fetchImpl = options.fetchImpl;
    this.log = options.log ?? ((message) => console.warn(message));
  }

  /** 운송장 1건 조회. 같은 번호의 동시 호출은 하나로 합친다. 예외를 던지지 않는다 */
  fetchInvoiceMeta(invoiceNo: string): Promise<NsvMetaResult> {
    const cfg = this.getConfig();
    const endpoints = this.endpointsFor(cfg.graphqlUrls);
    if (endpoints.length === 0) return Promise.resolve({ kind: "disabled" });

    const existing = this.inflight.get(invoiceNo);
    if (existing) return existing;
    const promise = this.lookup(invoiceNo, endpoints, cfg.timeoutMs).finally(() => this.inflight.delete(invoiceNo));
    this.inflight.set(invoiceNo, promise);
    return promise;
  }

  private endpointsFor(raw: string | undefined): Endpoint[] {
    if (this.parsed && this.parsed.raw === raw) return this.parsed.endpoints;
    const { urls, invalid } = parseNsvGraphqlUrls(raw);
    if (invalid.length > 0) {
      this.log(
        `[nsv] NSV_GRAPHQL_URLS 의 ${invalid.map((n) => `${n}번째`).join(", ")} 항목이 http(s) 주소 형식이 아니라 건너뜁니다.`,
      );
    }
    const endpoints = urls.map((url) => ({ url, host: new URL(url).host }));
    this.parsed = { raw, endpoints };
    return endpoints;
  }

  /**
   * 모든 엔드포인트에 동시에 묻는다. 결과는 목록 순서대로 본다: 앞쪽 엔드포인트가 아직 답하지 않았으면
   * 뒤쪽의 found 를 쓰지 않고 기다린다(순서 우선). 반대로 앞쪽이 모두 found 가 아닌 것으로 확정된 뒤의
   * 첫 found 는 나머지(느리거나 죽은 엔드포인트)를 기다리지 않고 바로 돌려준다.
   */
  private lookup(invoiceNo: string, endpoints: Endpoint[], timeoutMs: number): Promise<NsvMetaResult> {
    return new Promise((resolve) => {
      const results: Array<EndpointResult | undefined> = endpoints.map(() => undefined);
      let finished = false;

      const settle = () => {
        if (finished) return;
        for (const result of results) {
          if (!result) return; // 앞쪽이 아직 답하지 않았다
          if (result.kind === "found") {
            finished = true;
            return resolve(result);
          }
        }
        finished = true;
        // 전부 확정: found 는 없다. 정상 응답(not_found)이 하나라도 있으면 "없음", 아니면 실패
        if (results.some((result) => result?.kind === "not_found")) return resolve({ kind: "not_found" });
        const firstError = results.find((result) => result?.kind === "error");
        resolve({ kind: "error", reason: firstError?.kind === "error" ? firstError.reason : "network" });
      };

      endpoints.forEach((endpoint, index) => {
        this.query(endpoint, invoiceNo, timeoutMs)
          .catch((): EndpointResult => ({ kind: "error", reason: "network" }))
          .then((result) => {
            results[index] = result;
            settle();
          });
      });
    });
  }

  /** 엔드포인트 1곳 조회. 예외를 던지지 않고 실패는 로그 1줄을 남긴다 */
  private async query(endpoint: Endpoint, invoiceNo: string, timeoutMs: number): Promise<EndpointResult> {
    const fail = (reason: NsvErrorReason, status?: number): EndpointResult => {
      this.logFailure(endpoint.host, reason, invoiceNo, status);
      return { kind: "error", reason };
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let text: string;
    try {
      const res = await (this.fetchImpl ?? fetch)(endpoint.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: NSV_QUERY, variables: { input: { trackingNo: invoiceNo } } }),
        cache: "no-store",
        signal: controller.signal,
      });
      status = res.status;
      text = await res.text();
    } catch {
      return fail(controller.signal.aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }

    if (status >= 500) return fail("http_error", status);
    if (text.length > MAX_BODY_CHARS) return fail("invalid_response", status);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(status >= 400 ? "http_error" : "invalid_response", status);
    }
    if (!isRecord(body)) return fail("invalid_response", status);

    // GraphQL errors 가 있으면 부분 데이터가 있어도 쓰지 않는다
    const errors = body.errors;
    if (errors !== undefined && errors !== null && !(Array.isArray(errors) && errors.length === 0)) {
      return fail(Array.isArray(errors) && isSchemaMismatch(errors) ? "schema_mismatch" : "graphql_error", status);
    }
    if (status >= 400) return fail("http_error", status);

    const node = isRecord(body.data) ? body.data.getTrackingSiteInvoice : undefined;
    if (!isRecord(node) || typeof node.found !== "boolean") return fail("invalid_response", status);
    if (!node.found) return { kind: "not_found" };
    return { kind: "found", meta: sanitizeMeta(node) };
  }

  private logFailure(host: string, reason: NsvErrorReason, invoiceNo: string, status?: number): void {
    const parts = [`host=${host}`, `reason=${reason}`];
    if (status !== undefined) parts.push(`http=${status}`);
    parts.push(`no=***${invoiceNo.slice(-4)}`);
    this.log(`[nsv] 조회 실패 ${parts.join(" ")}`);
  }
}

// dev 핫리로드에서도 in-flight 상태가 유지되도록 globalThis 에 둔다
const globalForClient = globalThis as unknown as { __nsvClient?: NsvClient };

export function getDefaultNsvClient(): NsvClient {
  const existing = globalForClient.__nsvClient;
  // 핫리로드로 이 모듈이 다시 평가되면 옛 인스턴스는 instanceof 를 통과하지 못한다. 그때는 새로 만든다 (운영에서는 항상 재사용)
  if (existing instanceof NsvClient) return existing;
  return (globalForClient.__nsvClient = new NsvClient());
}

/** 운송장 1건의 NSV meta 조회 (프로세스 전역 클라이언트 사용). NSV_GRAPHQL_URLS 가 없으면 즉시 disabled */
export function fetchNsvInvoiceMeta(invoiceNo: string): Promise<NsvMetaResult> {
  return getDefaultNsvClient().fetchInvoiceMeta(invoiceNo);
}

/** 테스트용: 전역 클라이언트(in-flight 상태)를 초기화한다 */
export function __resetNsvClientForTest(): void {
  globalForClient.__nsvClient = undefined;
}

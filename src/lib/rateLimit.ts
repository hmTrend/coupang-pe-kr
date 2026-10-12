// 프로세스 메모리 기반 고정 윈도우 rate limit (단일 인스턴스 전제)

interface Bucket {
  count: number;
  resetAt: number;
}

const globalForLimit = globalThis as unknown as {
  __rateBuckets?: Map<string, Bucket>;
};

const MAX_BUCKETS = 10_000;

function buckets(): Map<string, Bucket> {
  return (globalForLimit.__rateBuckets ??= new Map());
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const map = buckets();

  // 메모리 폭주 방지: 너무 커지면 만료된 버킷을 정리 (그래도 크면 가장 오래된 것부터 제거)
  if (map.size >= MAX_BUCKETS) {
    for (const [k, b] of map) if (b.resetAt <= now) map.delete(k);
    if (map.size >= MAX_BUCKETS) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }

  let bucket = map.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    map.set(key, bucket);
  }
  bucket.count++;

  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** 테스트용 */
export function __resetRateLimit(): void {
  globalForLimit.__rateBuckets = undefined;
}

/**
 * 클라이언트 IP 추정. 리버스 프록시(nginx/Cloudflare)가 아래 헤더를 덮어써 주는 배포를 전제로 한다.
 * 프록시 없이 직접 노출하면 헤더 위조로 제한을 우회할 수 있다. (README 참고)
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}

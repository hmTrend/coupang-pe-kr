// POST /api/invoices — NSV 등 외부 프로그램의 운송장번호 수집(ingest) API
// 인증: Authorization: Bearer <key> 또는 x-api-key. 키는 INGEST_API_KEYS="operator:KEY,..." 로 설정.
// 이 API 는 배송 조회 API(Delivery Tracker)를 호출하지 않는다 — 대량 등록이 쿼터를 소진하지 않게 하기 위함.
import { extractApiKey, matchApiKey, parseApiKeys } from "@/lib/auth";
import { validateIngestBody } from "@/lib/ingest";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 500건 × 필드 상한을 넉넉히 덮는 본문 크기 상한 */
const MAX_BODY_BYTES = 1_000_000;
const HEADERS = { "Cache-Control": "no-store" };

function fail(status: number, error: string, extra: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error }, { status, headers: { ...HEADERS, ...extra } });
}

export async function POST(request: Request): Promise<Response> {
  const keys = parseApiKeys(process.env.INGEST_API_KEYS);
  if (keys.length === 0) return fail(503, "ingest_disabled");

  const presented = extractApiKey(request.headers);
  const operator = presented ? matchApiKey(keys, presented) : null;
  if (!operator) {
    // 키 무차별 대입 방지: 실패한 시도만 IP 별로 센다
    const limit = rateLimit(`ingest-fail:${clientIp(request.headers)}`, 20, 60_000);
    if (!limit.ok) return fail(429, "rate_limited", { "Retry-After": String(limit.retryAfterSec) });
    return fail(401, "unauthorized", { "WWW-Authenticate": 'Bearer realm="ingest"' });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(413, "body_too_large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, "body_too_large");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "invalid_json");
  }

  const parsed = validateIngestBody(body);
  if (!parsed.ok) return fail(parsed.status, parsed.error);

  try {
    const { upserted, updated } = await getStore().upsertRegistrations(
      parsed.items,
      operator,
      new Date(),
    );
    return Response.json(
      {
        ok: true,
        received: parsed.received,
        upserted,
        updated,
        duplicates: parsed.duplicates,
        invalid: parsed.invalid,
      },
      { headers: HEADERS },
    );
  } catch (error) {
    console.error("[ingest] upsertRegistrations 실패:", error);
    return fail(500, "store_error");
  }
}

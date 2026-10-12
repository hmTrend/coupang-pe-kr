// GET /api/track/{운송장번호}[?refresh=1] — getTracking 결과를 JSON 으로 반환
import { apiRateLimitPerMin } from "@/lib/config";
import { safeDecode } from "@/lib/params";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { getTracking } from "@/lib/tracking";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(
  request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
): Promise<Response> {
  const limit = rateLimit(`track:${clientIp(request.headers)}`, apiRateLimitPerMin(), 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const { invoiceNo } = await context.params;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const result = await getTracking(safeDecode(invoiceNo), { forceRefresh: refresh });

  const status = result.status === "invalid" ? 400 : result.status === "unavailable" ? 503 : 200;
  return Response.json(result, { status, headers: NO_STORE });
}

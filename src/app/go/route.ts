// GET /go?q=... — 홈 입력창의 JS 비활성 폴백. 입력값을 정규화해 /{운송장번호} 로 보낸다.
import { normalizeInvoiceNo } from "@/lib/invoiceNo";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
  const target = q ? `/${encodeURIComponent(normalizeInvoiceNo(q) ?? q)}` : "/";
  return new Response(null, { status: 303, headers: { Location: target } });
}

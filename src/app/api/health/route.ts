// GET /api/health — 프로세스 상태 확인용 (배송 조회 API/DB 를 실제로 호출하지 않는다)
import { mongoConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      ok: true,
      time: new Date().toISOString(),
      store: mongoConfig().uri ? "mongo" : "memory",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

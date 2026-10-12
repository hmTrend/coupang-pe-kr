// /admin 경로 Basic Auth. ADMIN_PASSWORD 미설정이면 관리자 기능 비활성(503).
import { NextResponse, type NextRequest } from "next/server";
import { checkAdminAuth } from "@/lib/auth";

const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export function middleware(request: NextRequest) {
  const result = checkAdminAuth(request.headers.get("authorization"));

  if (result === "disabled") {
    return new NextResponse("관리자 페이지가 비활성화되어 있습니다. (ADMIN_PASSWORD 미설정)", {
      status: 503,
      headers: TEXT_HEADERS,
    });
  }
  if (result === "unauthorized") {
    return new NextResponse("인증이 필요합니다.", {
      status: 401,
      headers: { ...TEXT_HEADERS, "WWW-Authenticate": 'Basic realm="admin", charset="UTF-8"' },
    });
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};

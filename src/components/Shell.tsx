import Link from "next/link";
import CoupangHomeBanner, { PartnersNotice } from "./CoupangHomeBanner";

/** 공통 페이지 틀: 상단 사이트명 + 본문. wide 는 관리자 표용, banner=false 는 쿠팡 홈 배너를 빼는 용도(관리자) */
export default function Shell({
  children,
  wide = false,
  banner = true,
}: {
  children: React.ReactNode;
  wide?: boolean;
  banner?: boolean;
}) {
  const name = process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "배송조회";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-card">
        <div className={`mx-auto flex h-12 w-full items-center px-4 ${wide ? "max-w-6xl" : "max-w-xl"}`}>
          <Link href="/" className="text-base font-bold tracking-tight">
            {name}
          </Link>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 pb-10 pt-5 ${wide ? "max-w-6xl" : "max-w-xl"}`}>
        {banner && (
          <div className="mb-4">
            <CoupangHomeBanner />
          </div>
        )}
        {children}
        {banner && (
          <div className="mt-4">
            <CoupangHomeBanner />
            <PartnersNotice />
          </div>
        )}
      </main>
    </div>
  );
}

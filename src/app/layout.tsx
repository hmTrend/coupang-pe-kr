import type { Metadata, Viewport } from "next";
import "./globals.css";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

export function generateMetadata(): Metadata {
  const name = process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "배송조회";
  const url = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return {
    metadataBase: url ? new URL(url) : undefined,
    title: name,
    description: "운송장번호로 배송 상태를 바로 확인하세요.",
    applicationName: name,
    openGraph: { siteName: name, locale: "ko_KR", type: "website" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1117" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard: jsDelivr CDN 고정 버전 (실패 시 시스템 폰트로 폴백) */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href={PRETENDARD_CSS} crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}

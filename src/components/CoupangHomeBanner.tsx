import { coupangPartnersUrl } from "@/lib/config";

/**
 * 쿠팡 홈 바로가기 배너 (쿠팡 파트너스 링크). 텍스트 + 화살표 아이콘만 쓰고 로고/브랜드 그래픽은 쓰지 않는다.
 * 배너 전체가 하나의 링크(터치 대상 56px 이상)이며 새 탭으로 연다.
 */
export default function CoupangHomeBanner() {
  return (
    <a
      href={coupangPartnersUrl()}
      target="_blank"
      rel="sponsored nofollow noopener"
      className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-accent px-5 py-3 text-accent-fg transition-opacity hover:opacity-90 active:opacity-80"
    >
      <span className="min-w-0">
        <span className="block text-base font-bold">쿠팡 홈 바로가기</span>
        <span className="block text-xs opacity-90">로켓배송 상품 둘러보기</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

/** 쿠팡 파트너스 고지 문구. 하단 배너 바로 아래에 항상 함께 둔다 (정책상 필수라 끄는 옵션을 두지 않는다) */
export function PartnersNotice() {
  return (
    <p className="mt-2 px-1 text-xs leading-relaxed text-muted">
      이 링크는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
    </p>
  );
}

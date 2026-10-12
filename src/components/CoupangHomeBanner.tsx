import { coupangPartnersUrl } from "@/lib/config";

// 워드마크 글자별 색 (쿠팡 로고를 참고한 텍스트 표현이며 이미지 파일은 쓰지 않는다)
const WORDMARK = [
  { letters: "cou", color: "text-wordmark-ink" },
  { letters: "p", color: "text-[#e52528]" },
  { letters: "a", color: "text-[#f5b335]" },
  { letters: "n", color: "text-[#b8d432]" },
  { letters: "g", color: "text-[#58c1e8]" },
] as const;

/**
 * 쿠팡 홈 바로가기 배너 (쿠팡 파트너스 링크). 흰 카드 + 얇은 테두리, 텍스트 워드마크 + "홈 바로가기 →".
 * 배너 전체가 하나의 링크(터치 대상 56px 이상)이며 새 탭으로 연다. 접근성 이름은 aria-label 로 고정한다.
 */
export default function CoupangHomeBanner() {
  return (
    <a
      href={coupangPartnersUrl()}
      target="_blank"
      rel="sponsored nofollow noopener"
      aria-label="쿠팡 홈 바로가기"
      className="group flex min-h-14 items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-2.5 transition-colors hover:border-accent hover:bg-accent-soft active:border-accent active:bg-accent-soft"
    >
      <span className="min-w-0">
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <span aria-hidden="true" className="text-[22px] font-extrabold lowercase leading-none tracking-tighter">
            {WORDMARK.map((part) => (
              <span key={part.letters} className={part.color}>
                {part.letters}
              </span>
            ))}
          </span>
          <span className="text-base font-bold text-accent-text">홈 바로가기</span>
        </span>
        <span className="mt-1 block text-xs text-muted">로켓배송 상품 둘러보기</span>
      </span>
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6 shrink-0 text-accent-text transition-transform group-hover:translate-x-0.5"
        fill="none"
        aria-hidden="true"
      >
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

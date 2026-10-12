import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { loadTrackingData } from "@/lib/deliveryTracker/__fixtures__/load";
import type { TrackingResult } from "@/lib/tracking";
import Shell from "./Shell";
import TrackingView from "./TrackingView";

// InvoiceForm(useRouter)을 서버 렌더 테스트에서 쓸 수 있게 라우터를 흉내 낸다
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const NO = "10332152871106";
const DEFAULT_URL = "https://link.coupang.com/a/bQkvJ5";
const NOTICE = "이 링크는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";

// children 은 createElement 세 번째 인자로 넘긴다 (props 타입에는 children 이 필수라 단언으로 맞춘다)
const shell = (children: ReactNode, props: { wide?: boolean; banner?: boolean } = {}) =>
  renderToStaticMarkup(createElement(Shell, props as ComponentProps<typeof Shell>, children));
const tracking = (result: TrackingResult) => shell(createElement(TrackingView, { result }));

const ok: TrackingResult = {
  status: "ok",
  invoiceNo: NO,
  data: loadTrackingData("delivered"),
  stale: false,
  fetchedAt: "2026-10-08T10:00:00Z",
};
const unavailable: TrackingResult = { status: "unavailable", invoiceNo: NO, stale: false, reason: "upstream_unavailable" };
const notFound: TrackingResult = {
  status: "not_found",
  invoiceNo: NO,
  stale: false,
  notFound: { title: "검색결과가 없습니다.", message: "운송장 미등록 상태이거나 업체에서 상품을 준비중입니다." },
};
const invalid: TrackingResult = { status: "invalid", invoiceNo: "abc", stale: false };

/** 배너 앵커(쿠팡 파트너스 링크) 태그들 */
const bannerLinks = (html: string) => html.match(/<a [^>]*rel="sponsored[^>]*>/g) ?? [];

afterEach(() => vi.unstubAllEnvs());

describe("쿠팡 홈 바로가기 배너", () => {
  const pages: Array<[string, () => string]> = [
    ["홈", () => renderToStaticMarkup(createElement(HomePage))],
    ["조회 정상", () => tracking(ok)],
    ["조회 unavailable", () => tracking(unavailable)],
    ["조회 not_found", () => tracking(notFound)],
    ["조회 invalid", () => tracking(invalid)],
  ];

  it.each(pages)("%s 화면에 배너 링크가 상단/하단 2개 있고 기본 파트너스 URL 로 연결된다", (_name, render) => {
    const links = bannerLinks(render());
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain(`href="${DEFAULT_URL}"`);
      expect(link).toContain('target="_blank"');
      expect(link).toMatch(/rel="[^"]*\bsponsored\b[^"]*"/);
      expect(link).toMatch(/rel="[^"]*\bnofollow\b[^"]*"/);
      expect(link).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/);
      // 터치 대상 최소 높이 48px 이상 (min-h-14 = 56px)
      expect(link).toContain("min-h-14");
    }
  });

  // 사용자 지시(2026-10-13)로 파트너스 고지 문구는 넣지 않는다
  it.each(pages)("%s 화면에 파트너스 고지 문구가 없다", (_name, render) => {
    const html = render();
    expect(html).not.toContain(NOTICE);
    expect(html).not.toContain("파트너스 활동");
  });

  it("상단 배너는 본문 앞, 하단 배너는 본문 뒤에 놓인다", () => {
    const html = shell(createElement("p", null, "본문-마커"));
    const firstBanner = html.indexOf("쿠팡 홈 바로가기");
    const body = html.indexOf("본문-마커");
    const lastBanner = html.lastIndexOf("쿠팡 홈 바로가기");
    expect(firstBanner).toBeGreaterThan(html.indexOf("</header>"));
    expect(firstBanner).toBeLessThan(body);
    expect(lastBanner).toBeGreaterThan(body);
    expect(html).toContain("로켓배송 상품 둘러보기");
  });

  it("텍스트 워드마크 + 화살표 아이콘만 쓰고 로고 이미지는 쓰지 않는다", () => {
    const html = shell(null);
    expect(html).not.toContain("<img");
    expect(html).toContain("<svg");
    // 접근성 이름은 고정, 워드마크는 스크린리더에서 숨긴다
    expect(bannerLinks(html)).toHaveLength(2);
    for (const link of bannerLinks(html)) expect(link).toContain('aria-label="쿠팡 홈 바로가기"');
    const wordmarks = html.match(/<span aria-hidden="true" class="[^"]*">(?:<span class="[^"]*">[a-z]+<\/span>)+<\/span>/g) ?? [];
    expect(wordmarks).toHaveLength(2);
    // 글자별 색: cou(갈색 토큰) / p(레드) / a(노랑) / n(라임) / g(하늘)
    const letters = [...wordmarks[0]!.matchAll(/<span class="([^"]*)">([a-z]+)<\/span>/g)].map((m) => [m[2], m[1]]);
    expect(letters).toEqual([
      ["cou", "text-wordmark-ink"],
      ["p", "text-[#e52528]"],
      ["a", "text-[#f5b335]"],
      ["n", "text-[#b8d432]"],
      ["g", "text-[#58c1e8]"],
    ]);
    expect(wordmarks[0]).toMatch(/font-extrabold/);
    expect(wordmarks[0]).toMatch(/lowercase/);
    expect(wordmarks[0]).toMatch(/tracking-tighter/);
    // "홈 바로가기" 는 블루 강조색, 보조 문구는 muted
    expect(html).toMatch(/<span class="[^"]*text-accent-text[^"]*">홈 바로가기<\/span>/);
    expect(html).toMatch(/<span class="[^"]*text-muted[^"]*">로켓배송 상품 둘러보기<\/span>/);
  });

  it("배너는 흰 카드 + 얇은 테두리이고 hover/active 에서만 블루 톤이 된다", () => {
    const [link] = bannerLinks(shell(null));
    expect(link).toMatch(/class="[^"]*\bbg-card\b/);
    expect(link).toMatch(/class="[^"]*\bborder\b[^"]*\bborder-line\b/);
    expect(link).toMatch(/\bhover:border-accent\b/);
    expect(link).toMatch(/\bhover:bg-accent-soft\b/);
    expect(link).toMatch(/\bactive:bg-accent-soft\b/);
    // 꽉 찬 블루/틸 배경이 아니다
    expect(link).not.toMatch(/\sbg-accent\s|\sbg-accent"/);
  });

  it("NEXT_PUBLIC_COUPANG_PARTNERS_URL 로 링크를 바꿀 수 있다", () => {
    vi.stubEnv("NEXT_PUBLIC_COUPANG_PARTNERS_URL", " https://link.coupang.com/a/custom ");
    const html = tracking(ok);
    const links = bannerLinks(html);
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toContain('href="https://link.coupang.com/a/custom"');
    expect(html).not.toContain(DEFAULT_URL);
  });

  it("env 가 비었거나 http(s) 주소가 아니면 기본 URL 을 쓴다", () => {
    for (const value of ["", "   ", "javascript:alert(1)", "link.coupang.com/a/x"]) {
      vi.stubEnv("NEXT_PUBLIC_COUPANG_PARTNERS_URL", value);
      const links = bannerLinks(tracking(ok));
      expect(links).toHaveLength(2);
      for (const link of links) expect(link).toContain(`href="${DEFAULT_URL}"`);
    }
  });

  it("banner={false} 면 배너가 모두 빠진다", () => {
    const html = shell(createElement("p", null, "본문"), { wide: true, banner: false });
    expect(bannerLinks(html)).toHaveLength(0);
    expect(html).not.toContain("쿠팡 홈 바로가기");
    expect(html).toContain("본문");
  });

  it("관리자 페이지는 Shell 에 banner={false} 를 넘긴다", () => {
    const source = readFileSync(join(__dirname, "../app/admin/page.tsx"), "utf-8");
    expect(source).toMatch(/<Shell wide banner=\{false\}>/);
  });

  it("출처/공식 사이트 안내 문구는 없다", () => {
    for (const [, render] of pages) expect(render()).not.toMatch(/출처|공식 사이트|공식사이트/);
  });
});

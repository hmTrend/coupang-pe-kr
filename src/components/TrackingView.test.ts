import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadTrackingData } from "@/lib/deliveryTracker/__fixtures__/load";
import type { TrackingResult } from "@/lib/tracking";
import TrackingView from "./TrackingView";

const NO = "10332152871106";
const LINK = "https://link.tracker.delivery/track?client_id=abc&carrier_id=kr.coupangls&tracking_number=10332152871106";

const render = (result: TrackingResult, fallbackLink?: string | null) =>
  renderToStaticMarkup(createElement(TrackingView, { result, fallbackLink }));

const unavailable: TrackingResult = { status: "unavailable", invoiceNo: NO, stale: false, reason: "upstream_unavailable" };

describe("TrackingView", () => {
  it("조회 불가 + Tracking Link 가 있으면 보조 버튼을 보여준다", () => {
    const html = render(unavailable, LINK);
    expect(html).toContain("일시적으로 조회할 수 없습니다");
    expect(html).toContain("배송조회 페이지에서 보기");
    expect(html).toContain(`href="${LINK.replaceAll("&", "&amp;")}"`);
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("Client Id 가 없어 링크가 없으면 버튼을 숨긴다", () => {
    expect(render(unavailable, null)).not.toContain("배송조회 페이지에서 보기");
    expect(render({ ...unavailable, reason: "not_configured" })).not.toContain("배송조회 페이지에서 보기");
  });

  it("정상 조회 화면에는 보조 버튼이 없다", () => {
    const data = loadTrackingData("delivered");
    const html = render({ status: "ok", invoiceNo: NO, data, stale: false, fetchedAt: "2026-10-08T10:00:00Z" }, LINK);
    expect(html).not.toContain("배송조회 페이지에서 보기");
  });

  describe("정상 조회 화면 구성", () => {
    const data = loadTrackingData("delivered");
    const base = { status: "ok", invoiceNo: NO, stale: false, fetchedAt: "2026-10-08T10:00:00Z" } as const;
    const html = render({ ...base, data });

    const textOf = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    /** n 번째 <table> (문서 순서: 0 = 이동 내역 표, 1 = 택배사 표) */
    const tableAt = (markup: string, n: number) => (markup.match(/<table[\s\S]*?<\/table>/g) ?? [])[n] ?? "";
    const rowsOf = (table: string) => table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    const cellsOf = (row: string) => (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map(textOf);
    const eventRows = (markup: string) => rowsOf(/<tbody[\s\S]*?<\/tbody>/.exec(tableAt(markup, 0))?.[0] ?? "");

    it("상단 카드에 운송장번호 줄이 없고, 하단 택배사 표에만 송장번호가 있다", () => {
      expect(html).not.toContain("운송장번호");
      // 상단 카드(이동 내역 이전)에는 번호 자체도 나오지 않는다. 상태/단계바는 그대로 있다
      const top = html.split("이동 내역")[0];
      expect(top).not.toContain(NO);
      expect(top).toContain("배송완료");
      expect(top).toContain('aria-label="배송 단계"');
      // 하단 택배사 표의 송장번호 th/td
      expect(html).toMatch(/<th[^>]*>송장번호<\/th>\s*<td[^>]*>10332152871106<\/td>/);
    });

    it("복사 버튼이 없다", () => {
      expect(html).not.toContain("<button");
      expect(html).not.toContain("복사");
    });

    it("전화번호는 tel 링크 없이 일반 텍스트로만 나온다", () => {
      expect(html).not.toContain('href="tel:');
      expect(html).not.toContain("underline");
      expect(html).toMatch(/<th[^>]*>전화번호<\/th>\s*<td[^>]*>1544-9898<\/td>/);
      expect(html).not.toMatch(/<a[^>]*>\s*1544-9898/);
    });

    it("이동 내역 표의 머리글은 시간/현재위치/배송상태다", () => {
      const head = /<thead[\s\S]*?<\/thead>/.exec(tableAt(html, 0))?.[0] ?? "";
      const labels = (head.match(/<th[\s\S]*?<\/th>/g) ?? []).map(textOf);
      expect(labels).toEqual(["시간", "현재위치", "배송상태"]);
    });

    it("이동 내역은 시간 오름차순(최신이 아래)이고 마지막 행만 굵다", () => {
      const rows = eventRows(html);
      expect(rows).toHaveLength(data.events.length);

      // 상태 순서가 events(오름차순)와 같고, 시각도 오름차순이다
      expect(rows.map((r) => cellsOf(r)[2])).toEqual(data.events.map((e) => e.status));
      const times = rows.map((r) => /\d{4}-\d{2}-\d{2}<\/span><span[^>]*>(\d{2}:\d{2})/.exec(r)![1]);
      expect(times).toEqual([...times].sort());
      // 날짜와 시각이 두 줄로 나뉘어 들어간다
      expect(rows[0]).toContain("2026-10-08");
      expect(rows[0]).toContain("08:34");

      // 마지막 행만 font-bold
      const bold = rows.map((r) => /^<tr[^>]*font-bold/.test(r));
      expect(bold).toEqual(rows.map((_, i) => i === rows.length - 1));
      expect(rows.slice(0, -1).join("")).not.toContain("font-bold");
    });

    it("수령인 블록: 첫 줄 이름(굵게), 지역이 있으면 둘째 줄", () => {
      // 픽스처는 지역이 비어 있다 -> 이름 줄만 있고 둘째 줄이 없다
      expect(html).toMatch(/<p class="font-bold">이\*화 님<\/p><\/div>/);
      expect(html).not.toContain("배송지역");

      const withAddress = render({ ...base, data: { ...data, recipient: { name: "이*화", address: "서울 은평구" } } });
      expect(withAddress).toMatch(/<p class="font-bold">이\*화 님<\/p><p[^>]*>서울 은평구<\/p>/);
    });

    it("스냅샷에 호칭(sir/님)이 남아 있어도 화면에는 이름 + ' 님' 한 번만 나온다", () => {
      const withName = (name: string) => render({ ...base, data: { ...data, recipient: { name, address: "" } } });
      const sir = withName("권*성 sir");
      expect(sir).toContain("권*성 님");
      expect(sir).not.toMatch(/sir/i);
      expect(withName("권*성 SIR")).not.toMatch(/sir/i);
      const already = withName("이*화 님");
      expect(already).toContain("이*화 님</p>");
      expect(already).not.toContain("님 님");
      // 호칭만 있으면 이름 줄(과 블록)을 숨긴다
      const only = withName("sir");
      expect(only).not.toMatch(/sir/i);
      expect(only).not.toContain(" 님");
    });

    it("수령인 정보가 없으면 수령인 블록 전체를 숨긴다", () => {
      const none = render({ ...base, data: { ...data, recipient: null } });
      expect(none).not.toContain("이*화");
      expect(none).not.toContain(" 님");
      const blank = render({ ...base, data: { ...data, recipient: { name: "", address: "" } } });
      expect(blank).not.toContain(" 님");
      // 택배사 표는 그대로 남는다
      expect(none).toMatch(/<th[^>]*>택배사<\/th>/);
    });

    it("택배사 표는 택배사/전화번호/송장번호 3행이다", () => {
      const rows = rowsOf(tableAt(html, 1));
      expect(rows.map((r) => textOf(/<th[\s\S]*?<\/th>/.exec(r)![0]))).toEqual(["택배사", "전화번호", "송장번호"]);
      expect(rows.map((r) => cellsOf(r)[0])).toEqual([
        "Coupang Logistics Services",
        "1544-9898",
        NO,
      ]);
    });
  });

  it("이력이 없는 ok 결과는 안내 문구를 보여준다", () => {
    const data = loadTrackingData("empty-events");
    const html = render({ status: "ok", invoiceNo: NO, data, stale: false, fetchedAt: "2026-10-08T10:00:00Z" });
    expect(html).toContain("배송 이력 없음");
    expect(html).toContain("아직 배송 이력이 없습니다");
  });

  it("고객 화면에 출처/공식 사이트 관련 안내 문구를 넣지 않는다", () => {
    const data = loadTrackingData("delivered");
    const html =
      render({ status: "ok", invoiceNo: NO, data, stale: false, fetchedAt: "2026-10-08T10:00:00Z" }) +
      render(unavailable, LINK);
    expect(html).not.toMatch(/출처|공식 사이트|공식사이트/);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadTrackingData } from "@/lib/deliveryTracker/__fixtures__/load";
import { validateIngestBody } from "@/lib/ingest";
import { MemoryInvoiceStore } from "@/lib/store/memory";
import { createTracker, type TrackingMeta, type TrackingResult } from "@/lib/tracking";
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
    /** 수령인 블록 <dl> 의 [라벨, 값] 쌍 */
    const infoOf = (markup: string) => {
      const dl = /<dl[\s\S]*?<\/dl>/.exec(markup)?.[0] ?? "";
      const labels = (dl.match(/<dt[\s\S]*?<\/dt>/g) ?? []).map(textOf);
      const values = (dl.match(/<dd[\s\S]*?<\/dd>/g) ?? []).map(textOf);
      return labels.map((label, i) => [label, values[i]]);
    };

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

    it("배송문의 줄은 문의 연락처(기본 010-3277-0737)이고 번호 자체가 tel 링크, 오른쪽 끝에 문자보내기", () => {
      const row = rowsOf(tableAt(html, 1)).find((r) => r.includes(">배송문의<")) ?? "";
      expect(textOf(row)).toBe("배송문의 010-3277-0737 문자보내기");
      // 택배사 대표번호와 별도 전화하기 버튼은 없다
      expect(html).not.toContain("1544-9898");
      expect(html).not.toContain("전화하기");
      // 번호를 누르면 번호만 키패드에 채워진다
      expect(row).toMatch(/<a href="tel:010-3277-0737"[^>]*>010-3277-0737<\/a>/);
      // 문자보내기는 번호 뒤(오른쪽 끝)
      expect(row.indexOf("문자보내기")).toBeGreaterThan(row.indexOf("010-3277-0737"));
      expect(row).toMatch(/justify-between/);
      // 둘 다 링크처럼 보이되(링크색 + 밑줄) 버튼처럼 강조하지는 않는다 (배경·테두리·굵게 없음)
      const links = row.match(/<a[^>]*>/g) ?? [];
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toMatch(/\btext-accent-text\b/);
        expect(link).toMatch(/\bunderline\b/);
        expect(link).not.toMatch(/bg-accent|\bborder\b|font-bold|rounded/);
      }
    });

    it("문자보내기는 송장번호와 고객명이 상단에 채워진 문자를 연다", () => {
      const href = /href="(sms:[^"]+)"/.exec(html)?.[1].replaceAll("&amp;", "&") ?? "";
      expect(href.startsWith("sms:01032770737?&body=")).toBe(true);
      const body = decodeURIComponent(href.split("body=")[1]);
      expect(body).toBe(`[배송문의]\n송장번호: ${NO}\n고객명: 이*화 님\n\n`);
    });

    it("NEXT_PUBLIC_CONTACT_PHONE 으로 번호를 바꿀 수 있다", () => {
      vi.stubEnv("NEXT_PUBLIC_CONTACT_PHONE", "02-123-4567");
      try {
        const markup = render({ ...base, data });
        expect(markup).toContain("02-123-4567");
        expect(markup).toContain('href="tel:02-123-4567"');
        expect(markup).toContain('href="sms:021234567?&amp;body=');
      } finally {
        vi.unstubAllEnvs();
      }
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

    describe("등록 정보(meta): 수령인 이름 밑 상품명/받는주소/배송요청사항", () => {
      const meta: TrackingMeta = {
        productName: "[노출] 빨간 양말 세트 (L)",
        receiverAddress: "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호",
        deliveryMessage: "직접 받고 부재 시 문 앞 (*********)",
        receiverName: "김*준",
      };
      const withMeta = (m: TrackingMeta | undefined, recipient = data.recipient) =>
        render({ ...base, data: { ...data, recipient }, meta: m });
      it("이름(굵게) 바로 밑에 상품명 -> 받는주소 -> 배송요청사항 행이 순서대로 나온다", () => {
        const markup = withMeta(meta);
        expect(markup).toMatch(/<p class="font-bold">이\*화 님<\/p><dl/);
        expect(infoOf(markup)).toEqual([
          ["상품명", "[노출] 빨간 양말 세트 (L)"],
          ["받는주소", "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호"],
          ["배송요청사항", "직접 받고 부재 시 문 앞 (*********)"],
        ]);
        // 라벨은 회색(text-muted), 한 구역 안에서 이름 -> 정보 행 -> (그 아래) 택배사 표 순서
        expect(markup).toMatch(/<dt class="text-muted">상품명<\/dt>/);
        expect(markup.indexOf("이*화 님")).toBeLessThan(markup.indexOf("<dl"));
        expect(markup.indexOf("</dl>")).toBeLessThan(markup.lastIndexOf("<table"));
        expect(markup.indexOf("</dl>")).toBeLessThan(markup.indexOf("Coupang Logistics Services"));
      });

      it("택배사 표(택배사/배송문의/송장번호)는 그대로이고 정보 행은 표가 아니다", () => {
        const markup = withMeta(meta);
        expect((markup.match(/<table/g) ?? []).length).toBe(2);
        const rows = rowsOf(tableAt(markup, 1));
        expect(rows.map((r) => textOf(/<th[\s\S]*?<\/th>/.exec(r)![0]))).toEqual(["택배사", "배송문의", "송장번호"]);
        expect(rows.map((r) => cellsOf(r)[0])).toEqual([
          "Coupang Logistics Services",
          "010-3277-0737 문자보내기",
          NO,
        ]);
        expect(eventRows(markup)).toHaveLength(data.events.length);
      });

      it("값이 없는 행은 숨긴다", () => {
        expect(infoOf(withMeta({ productName: "양말" }))).toEqual([["상품명", "양말"]]);
        expect(infoOf(withMeta({ deliveryMessage: "문 앞 (*********)" }))).toEqual([
          ["배송요청사항", "문 앞 (*********)"],
        ]);
        expect(infoOf(withMeta({ productName: "양말", deliveryMessage: "문 앞" }))).toEqual([
          ["상품명", "양말"],
          ["배송요청사항", "문 앞"],
        ]);
        // 공백뿐인 값도 없는 것으로 본다
        expect(infoOf(withMeta({ productName: "  ", receiverAddress: "서울 은평구" }))).toEqual([
          ["받는주소", "서울 은평구"],
        ]);
        const none = withMeta({ productName: "" });
        expect(none).not.toContain("<dl");
        expect(none).not.toMatch(/상품명|받는주소|배송요청사항/);
      });

      it("Delivery Tracker 수령인 이름이 있으면 그것을, 없으면 meta.receiverName 을 쓴다", () => {
        expect(withMeta(meta)).toContain("이*화 님");
        expect(withMeta(meta)).not.toContain("김*준");

        const fallback = withMeta(meta, null);
        expect(fallback).toMatch(/<p class="font-bold">김\*준 님<\/p><dl/);
        const blankName = withMeta(meta, { name: "sir", address: "" }); // 호칭만 있으면 이름 없음으로 본다
        expect(blankName).toContain("김*준 님");
        expect(blankName).not.toMatch(/sir/i);
        // meta 이름에 호칭이 붙어 있어도 " 님" 은 한 번만
        expect(withMeta({ ...meta, receiverName: "김*준 님" }, null)).not.toContain("님 님");
      });

      it("이름이 둘 다 없고 아래 정보만 있으면 이름 줄 없이 정보 행만 표시한다", () => {
        const markup = withMeta({ productName: "양말", receiverAddress: "서울 은평구" }, null);
        expect(markup).not.toContain(" 님");
        expect(markup).not.toContain('<p class="font-bold">');
        expect(infoOf(markup)).toEqual([
          ["상품명", "양말"],
          ["받는주소", "서울 은평구"],
        ]);
        // 첫 요소라 위쪽 간격(mt-2.5)이 붙지 않는다
        expect(markup).toMatch(/<div class="mb-3 border-b border-line pb-3 text-sm"><dl class="grid [^"]*"><dt/);
        expect(markup).not.toContain("mt-2.5");
      });

      it("API 지역(recipient.address)은 등록된 받는주소가 없을 때만 지금처럼 보여준다", () => {
        const recipient = { name: "이*화", address: "서울 은평구" };
        // receiverAddress 가 없으면: 이름 -> 지역 줄 -> 정보 행
        const noAddress = withMeta({ productName: "양말" }, recipient);
        expect(noAddress).toMatch(/<p class="font-bold">이\*화 님<\/p><p[^>]*>서울 은평구<\/p><dl/);
        expect(infoOf(noAddress)).toEqual([["상품명", "양말"]]);
        // receiverAddress 가 있으면 지역 줄은 숨기고 받는주소 행만 쓴다
        const withAddress = withMeta({ receiverAddress: "경기도 성남시 ***" }, recipient);
        expect(withAddress).not.toContain("서울 은평구");
        expect(infoOf(withAddress)).toEqual([["받는주소", "경기도 성남시 ***"]]);
      });

      it("미등록 번호(meta 없음/빈 meta)는 정보 행 없이 기존과 같은 화면이다", () => {
        for (const m of [undefined, {}] as const) {
          const markup = withMeta(m);
          expect(markup).not.toContain("<dl");
          expect(markup).toMatch(/<p class="font-bold">이\*화 님<\/p><\/div>/);
        }
        expect(withMeta(undefined)).toBe(withMeta({}));
        expect(withMeta(undefined)).toBe(html);
        // meta 도 수령인도 없으면 블록 전체를 숨기는 기존 동작
        const nothing = withMeta(undefined, null);
        expect(nothing).not.toContain(" 님");
        expect(nothing).toMatch(/<th[^>]*>택배사<\/th>/);
      });

      it("긴 상품명·주소가 360px 폭에서 가로로 넘치지 않게 칸 폭과 줄바꿈을 제한한다", () => {
        const markup = withMeta({ productName: "아주긴상품명".repeat(30), receiverAddress: "가".repeat(200) });
        // 라벨 칸은 고정, 값 칸은 minmax(0,1fr) + min-w-0 로 줄어들어 줄바꿈된다
        expect(markup).toMatch(/<dl class="grid grid-cols-\[5\.5rem_minmax\(0,1fr\)\] /);
        expect((markup.match(/<dd class="min-w-0">/g) ?? []).length).toBe(2);
        expect(markup).not.toMatch(/whitespace-nowrap[^>]*>(?:아주긴|가가)/);
      });

      it("값은 HTML 이스케이프되어 나간다", () => {
        const markup = withMeta({ productName: '<img src=x onerror="alert(1)">' });
        expect(markup).not.toContain("<img");
        expect(markup).toContain("&lt;img");
      });

      it("복사 버튼/출처 문구가 없다 (등록 정보가 있어도)", () => {
        const markup = withMeta(meta);
        expect(markup).not.toContain("<button");
        expect(markup).not.toContain("복사");
        expect(markup).not.toMatch(/출처|공식 사이트|공식사이트/);
        // 상단 카드에는 등록 정보가 나오지 않는다 (수령인 블록에만)
        expect(markup.split("이동 내역")[0]).not.toContain("빨간 양말");
      });
    });

    it("수집 -> 저장 -> 조회 -> 화면 전체 흐름에서 원본 숫자는 화면 HTML 에 나오지 않는다", async () => {
      const parsed = validateIngestBody({
        items: [
          {
            invoiceNo: NO,
            orderId: "ORD-SECRET-1",
            memo: "내부메모-유출금지",
            productName: "[노출] 빨간 양말 세트 (L)",
            receiverName: "김*준",
            // NSV 가 가리지 못하고 원본 그대로 보낸 경우를 가정한다
            receiverAddress: "충청북도 청주시 상당구 용암동 1234 지음프라자 101동 1203호 (010-1234-5678)",
            deliveryMessage: "직접 받고 부재 시 문 앞 (공동현관 5678) 비번 9999 #7777 연락 010-1234-5678",
          },
        ],
      });
      if (!parsed.ok) throw new Error("검증 실패");
      const store = new MemoryInvoiceStore();
      await store.upsertRegistrations(parsed.items, "nsv", new Date("2026-10-08T01:00:00Z"));
      const tracker = createTracker({
        store,
        fetchUpstream: async () => ({ kind: "ok", data }),
        now: () => Date.parse("2026-10-08T10:00:00Z"),
        config: {
          cacheTtlMs: 120_000,
          notFoundTtlMs: 60_000,
          minForceRefreshMs: 30_000,
          deliveredRecheckMs: 3_600_000,
          allowUnregisteredLookup: true,
        },
      });

      const markup = render(await tracker(NO));
      expect(infoOf(markup)).toEqual([
        ["상품명", "[노출] 빨간 양말 세트 (L)"],
        ["받는주소", "충청북도 청주시 상당구 용암동 **** 지음프라자 ***동 ****호 (****)"],
        ["배송요청사항", "직접 받고 부재 시 문 앞 (*********) 비번 **** **** 연락 ****"],
      ]);
      for (const raw of ["1234", "1203", "101동", "010-1234-5678", "5678", "9999", "7777", "ORD-SECRET-1", "내부메모"]) {
        expect(markup, raw).not.toContain(raw);
      }
      // 이름은 Delivery Tracker 값이 우선
      expect(markup).toContain("이*화 님");
    });

    it("택배사 표는 택배사/배송문의/송장번호 3행이다", () => {
      const rows = rowsOf(tableAt(html, 1));
      expect(rows.map((r) => textOf(/<th[\s\S]*?<\/th>/.exec(r)![0]))).toEqual(["택배사", "배송문의", "송장번호"]);
      expect(rows.map((r) => cellsOf(r)[0])).toEqual([
        "Coupang Logistics Services",
        "010-3277-0737 문자보내기",
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

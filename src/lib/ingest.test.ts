import { describe, expect, it } from "vitest";
import { FIELD_LIMITS, MAX_INGEST_ITEMS, validateIngestBody } from "./ingest";

function parse(body: unknown) {
  const result = validateIngestBody(body);
  if (!result.ok) throw new Error(`검증 실패: ${result.error}`);
  return result;
}

describe("validateIngestBody - 본문 형태", () => {
  it.each([null, undefined, "x", 123, [], {}, { items: "x" }, { items: {} }])(
    "items 배열이 아닌 본문 %j 는 400",
    (body) => {
      const result = validateIngestBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    },
  );

  it("빈 배열은 400", () => {
    const result = validateIngestBody({ items: [] });
    expect(result).toEqual({ ok: false, status: 400, error: "items_empty" });
  });

  it("500건까지 허용, 501건부터 413", () => {
    const make = (n: number) => ({
      items: Array.from({ length: n }, (_, i) => ({ invoiceNo: String(10_000_000_000_000 + i) })),
    });
    const ok = validateIngestBody(make(MAX_INGEST_ITEMS));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.items).toHaveLength(500);

    const tooMany = validateIngestBody(make(MAX_INGEST_ITEMS + 1));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.status).toBe(413);
  });
});

describe("validateIngestBody - 운송장번호", () => {
  it("공백·하이픈을 정규화한다", () => {
    const result = parse({ items: [{ invoiceNo: " 1033-2152-871106 " }, { invoiceNo: 10332152871107 }] });
    expect(result.items.map((i) => i.invoiceNo)).toEqual(["10332152871106", "10332152871107"]);
    expect(result.invalid).toEqual([]);
  });

  it("유효하지 않은 항목은 index/원본/사유와 함께 invalid 로 모으고 나머지는 처리한다", () => {
    const result = parse({
      received: 999, // 무시됨
      items: [
        { invoiceNo: "10332152871106" },
        { invoiceNo: "123" },
        { invoiceNo: "abcdefghijklmn" },
        { productName: "번호 없음" },
        "문자열 항목",
        null,
        { invoiceNo: "10332152871107", carrier: "hanjin" },
        { invoiceNo: "10332152871108", carrier: "Coupang" },
      ],
    });
    expect(result.received).toBe(8);
    expect(result.items.map((i) => i.invoiceNo)).toEqual(["10332152871106", "10332152871108"]);
    expect(result.invalid).toEqual([
      { index: 1, invoiceNo: "123", reason: "invalid_invoice_no" },
      { index: 2, invoiceNo: "abcdefghijklmn", reason: "invalid_invoice_no" },
      { index: 3, invoiceNo: "", reason: "invalid_invoice_no" },
      { index: 4, invoiceNo: "", reason: "not_an_object" },
      { index: 5, invoiceNo: "", reason: "not_an_object" },
      { index: 6, invoiceNo: "10332152871107", reason: "unsupported_carrier" },
    ]);
  });

  it("원본 번호가 아주 길어도 invalid 보고에는 40자까지만 담는다", () => {
    const result = parse({ items: [{ invoiceNo: "9".repeat(200) }] });
    expect(result.invalid[0].invoiceNo).toHaveLength(40);
  });
});

describe("validateIngestBody - meta 필드", () => {
  it("문자열은 trim/공백 정리/제어문자 제거, 빈 값은 생략", () => {
    const result = parse({
      items: [
        {
          invoiceNo: "10332152871106",
          orderId: "  ORD-1  ",
          productName: "빨간\n  양말\u0000 세트",
          receiverName: "   ",
          orderedAt: "2026-10-08T09:00:00+09:00",
          memo: null,
        },
      ],
    });
    expect(result.items[0].meta).toEqual({
      orderId: "ORD-1",
      productName: "빨간 양말 세트",
      orderedAt: "2026-10-08T09:00:00+09:00",
    });
  });

  it("숫자 값(주문번호 등)은 문자열로 받아준다", () => {
    const result = parse({ items: [{ invoiceNo: "10332152871106", orderId: 20261008001 }] });
    expect(result.items[0].meta.orderId).toBe("20261008001");
  });

  it("문자열 필드는 길이 상한에서 잘라 저장한다", () => {
    const result = parse({
      items: [
        {
          invoiceNo: "10332152871106",
          orderId: "o".repeat(500),
          productName: "p".repeat(500),
          receiverName: "r".repeat(500),
          receiverAddress: "가".repeat(500),
          deliveryMessage: "나".repeat(500),
          orderedAt: "t".repeat(500),
          memo: "m".repeat(5000),
        },
      ],
    });
    const meta = result.items[0].meta;
    expect(meta.orderId).toHaveLength(FIELD_LIMITS.orderId);
    expect(meta.productName).toHaveLength(FIELD_LIMITS.productName);
    expect(meta.receiverName).toHaveLength(FIELD_LIMITS.receiverName);
    expect(meta.receiverAddress).toHaveLength(FIELD_LIMITS.receiverAddress);
    expect(meta.deliveryMessage).toHaveLength(FIELD_LIMITS.deliveryMessage);
    expect(meta.orderedAt).toHaveLength(FIELD_LIMITS.orderedAt);
    expect(meta.memo).toHaveLength(FIELD_LIMITS.memo);
    expect(FIELD_LIMITS.receiverAddress).toBe(200);
    expect(FIELD_LIMITS.deliveryMessage).toBe(200);
  });

  it("객체/배열/불리언 값은 해당 항목만 invalid(invalid_type:필드)", () => {
    const result = parse({
      items: [
        { invoiceNo: "10332152871106", productName: { a: 1 } },
        { invoiceNo: "10332152871107", memo: ["x"] },
        { invoiceNo: "10332152871108", orderId: true },
        { invoiceNo: "10332152871109" },
      ],
    });
    expect(result.items.map((i) => i.invoiceNo)).toEqual(["10332152871109"]);
    expect(result.invalid.map((i) => i.reason)).toEqual([
      "invalid_type:productName",
      "invalid_type:memo",
      "invalid_type:orderId",
    ]);
  });
});

describe("validateIngestBody - 수취인 주소 / 배송메시지", () => {
  const NO = "10332152871106";

  it("receiverAddress / deliveryMessage 를 meta 로 받는다 (productName 은 노출상품명)", () => {
    const result = parse({
      items: [
        {
          invoiceNo: NO,
          productName: "[노출] 빨간 양말 세트 (L)",
          receiverName: "김*준",
          receiverAddress: "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호",
          deliveryMessage: "직접 받고 부재 시 문 앞 (*********)",
        },
      ],
    });
    expect(result.invalid).toEqual([]);
    expect(result.items[0].meta).toEqual({
      productName: "[노출] 빨간 양말 세트 (L)",
      receiverName: "김*준",
      receiverAddress: "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호",
      deliveryMessage: "직접 받고 부재 시 문 앞 (*********)",
    });
  });

  it("둘 다 선택 필드다: 안 보내거나 null/빈 문자열이면 meta 에 넣지 않는다 (기존 값을 지우지 않게)", () => {
    const result = parse({
      items: [
        { invoiceNo: NO, productName: "양말" },
        { invoiceNo: "10332152871107", receiverAddress: null, deliveryMessage: "   " },
      ],
    });
    expect(result.items[0].meta).toEqual({ productName: "양말" });
    expect(result.items[1].meta).toEqual({});
    expect("receiverAddress" in result.items[1].meta).toBe(false);
    expect("deliveryMessage" in result.items[1].meta).toBe(false);
  });

  it("객체/배열/불리언이면 해당 항목만 invalid(invalid_type:필드), 나머지는 처리한다", () => {
    const result = parse({
      items: [
        { invoiceNo: NO, receiverAddress: { a: 1 } },
        { invoiceNo: "10332152871107", deliveryMessage: ["x"] },
        { invoiceNo: "10332152871108", deliveryMessage: false },
        { invoiceNo: "10332152871109", receiverAddress: "서울 은평구", deliveryMessage: "문 앞" },
      ],
    });
    expect(result.items.map((i) => i.invoiceNo)).toEqual(["10332152871109"]);
    expect(result.invalid).toEqual([
      { index: 0, invoiceNo: NO, reason: "invalid_type:receiverAddress" },
      { index: 1, invoiceNo: "10332152871107", reason: "invalid_type:deliveryMessage" },
      { index: 2, invoiceNo: "10332152871108", reason: "invalid_type:deliveryMessage" },
    ]);
  });

  it("각각 200자를 넘으면 자르고, 자른 뒤에도 마스킹이 유지된다", () => {
    const result = parse({
      items: [
        {
          invoiceNo: NO,
          receiverAddress: `${"가".repeat(190)} 1203호 ${"나".repeat(100)}`,
          deliveryMessage: `${"다".repeat(190)} 비번 1234 ${"라".repeat(100)}`,
        },
      ],
    });
    const { receiverAddress, deliveryMessage } = result.items[0].meta;
    expect(receiverAddress).toHaveLength(200);
    expect(deliveryMessage).toHaveLength(200);
    expect(receiverAddress).not.toMatch(/\d/);
    expect(deliveryMessage).not.toMatch(/\d/);
    expect(receiverAddress?.startsWith(`${"가".repeat(190)} ****호`)).toBe(true);
  });

  it("사이트에서도 한 번 더 마스킹한다 (NSV 가 가리지 못한 값 방어)", () => {
    const result = parse({
      items: [
        {
          invoiceNo: NO,
          receiverName: "홍길동 010-1234-5678",
          receiverAddress: "충청북도 청주시 상당구 용암동 1234 지음프라자 101동 1203호",
          deliveryMessage: "직접 받고 부재 시 문 앞 (공동현관 1234) 비번 5678 #9999 010-1234-5678",
        },
      ],
    });
    const meta = result.items[0].meta;
    expect(meta.receiverName).toBe("홍길동 ****");
    expect(meta.receiverAddress).toBe("충청북도 청주시 상당구 용암동 **** 지음프라자 ***동 ****호");
    expect(meta.deliveryMessage).toBe("직접 받고 부재 시 문 앞 (*********) 비번 **** **** ****");
    const stored = JSON.stringify(meta);
    for (const raw of ["010-1234-5678", "1234", "5678", "9999", "1203", "101"]) {
      expect(stored, raw).not.toContain(raw);
    }
  });

  it("이미 마스킹된 값은 그대로 저장된다 (멱등)", () => {
    const masked = {
      receiverName: "김*준",
      receiverAddress: "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호",
      deliveryMessage: "직접 받고 부재 시 문 앞 (*********)",
    };
    const result = parse({ items: [{ invoiceNo: NO, ...masked }] });
    expect(result.items[0].meta).toEqual(masked);
  });

  it("NSV 가 이미 마스킹한 주소·메시지(NSV 실제 출력)는 재마스킹해도 그대로 저장된다", () => {
    const masked = [
      ["서울 노원구 상계3동 ****", "공동현관 비번 *** 문앞"],
      ["서울 강남구 도산대로45길 *** ***동 ****호", "비밀번호는 **** 입니다"],
      ["서울 종로구 종로1가 *** 신림1동 을지로3가 세종대로23길 ***", "직접 받고 부재 시 문 앞 (*********)"],
      ["경기도 성남시 분당구 판교로 **** B***호", "***시 이후 배송"],
    ];
    const result = parse({
      items: masked.map(([receiverAddress, deliveryMessage], i) => ({
        invoiceNo: String(10332152871100 + i),
        receiverAddress,
        deliveryMessage,
      })),
    });
    expect(result.items.map((i) => [i.meta.receiverAddress, i.meta.deliveryMessage])).toEqual(masked);
  });

  it("공백·제어문자는 기존 필드와 같이 정리한다", () => {
    const result = parse({
      items: [{ invoiceNo: NO, receiverAddress: "  충청북도\n  청주시\u0000 ", deliveryMessage: "문   앞\t" }],
    });
    expect(result.items[0].meta).toEqual({ receiverAddress: "충청북도 청주시", deliveryMessage: "문 앞" });
  });

  it("같은 요청 안의 중복 번호는 새 필드도 뒤쪽 값이 이기고, 앞쪽에만 있던 값은 유지한다", () => {
    const result = parse({
      items: [
        { invoiceNo: NO, receiverAddress: "서울 은평구", deliveryMessage: "문 앞" },
        { invoiceNo: NO, deliveryMessage: "경비실" },
      ],
    });
    expect(result.items).toEqual([
      { invoiceNo: NO, meta: { receiverAddress: "서울 은평구", deliveryMessage: "경비실" } },
    ]);
  });
});

describe("validateIngestBody - 중복", () => {
  it("같은 요청 안의 중복 번호는 하나로 합치고 값이 있는 뒤쪽 필드가 이긴다", () => {
    const result = parse({
      items: [
        { invoiceNo: "10332152871106", productName: "A", memo: "첫번째" },
        { invoiceNo: "1033-2152-871106", productName: "B" },
      ],
    });
    expect(result.received).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(result.items).toEqual([
      { invoiceNo: "10332152871106", meta: { productName: "B", memo: "첫번째" } },
    ]);
  });
});

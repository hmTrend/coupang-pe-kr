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
          orderedAt: "t".repeat(500),
          memo: "m".repeat(5000),
        },
      ],
    });
    const meta = result.items[0].meta;
    expect(meta.orderId).toHaveLength(FIELD_LIMITS.orderId);
    expect(meta.productName).toHaveLength(FIELD_LIMITS.productName);
    expect(meta.receiverName).toHaveLength(FIELD_LIMITS.receiverName);
    expect(meta.orderedAt).toHaveLength(FIELD_LIMITS.orderedAt);
    expect(meta.memo).toHaveLength(FIELD_LIMITS.memo);
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

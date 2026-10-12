// 수집(ingest) API 요청 본문 검증/정규화 (순수 함수)
import { normalizeInvoiceNo } from "@/lib/invoiceNo";
import type { InvoiceMeta, RegistrationInput } from "@/lib/store/types";

export const MAX_INGEST_ITEMS = 500;

/** 문자열 필드 길이 상한 (초과분은 잘라서 저장한다) */
export const FIELD_LIMITS = {
  orderId: 64,
  productName: 200,
  receiverName: 50,
  orderedAt: 40,
  memo: 500,
} as const;

type MetaField = keyof typeof FIELD_LIMITS;
const META_FIELDS = Object.keys(FIELD_LIMITS) as MetaField[];

export interface InvalidItem {
  index: number;
  invoiceNo: string;
  reason: string;
}

export type IngestParseResult =
  | {
      ok: true;
      received: number;
      items: RegistrationInput[];
      invalid: InvalidItem[];
      /** 같은 요청 안에서 번호가 중복된 건수 (뒤에 온 값이 앞의 값을 덮어쓴다) */
      duplicates: number;
    }
  | { ok: false; status: 400 | 413; error: string };

/** 제어문자 제거 + 공백 정리 + 길이 제한. 값이 비면 undefined */
function cleanString(value: string, max: number): string | undefined {
  const cleaned = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned === "" ? undefined : cleaned;
}

function rawInvoiceLabel(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 40);
  if (typeof value === "number") return String(value).slice(0, 40);
  return "";
}

export function validateIngestBody(body: unknown): IngestParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "body_must_be_object" };
  }
  const rawItems = (body as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return { ok: false, status: 400, error: "items_required" };
  if (rawItems.length === 0) return { ok: false, status: 400, error: "items_empty" };
  if (rawItems.length > MAX_INGEST_ITEMS) {
    return { ok: false, status: 413, error: `too_many_items(max ${MAX_INGEST_ITEMS})` };
  }

  const invalid: InvalidItem[] = [];
  const merged = new Map<string, InvoiceMeta>();
  let duplicates = 0;

  rawItems.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      invalid.push({ index, invoiceNo: "", reason: "not_an_object" });
      return;
    }
    const item = raw as Record<string, unknown>;
    const label = rawInvoiceLabel(item.invoiceNo);

    const invoiceNo = normalizeInvoiceNo(item.invoiceNo);
    if (!invoiceNo) {
      invalid.push({ index, invoiceNo: label, reason: "invalid_invoice_no" });
      return;
    }

    if (item.carrier !== undefined && item.carrier !== null) {
      if (typeof item.carrier !== "string" || item.carrier.trim().toLowerCase() !== "coupang") {
        invalid.push({ index, invoiceNo: label, reason: "unsupported_carrier" });
        return;
      }
    }

    const meta: InvoiceMeta = {};
    for (const field of META_FIELDS) {
      const value = item[field];
      if (value === undefined || value === null) continue;
      // 숫자(주문번호 등)는 문자열로 받아준다. 그 외 타입은 거부.
      const asString =
        typeof value === "string"
          ? value
          : typeof value === "number" && Number.isFinite(value)
            ? String(value)
            : null;
      if (asString === null) {
        invalid.push({ index, invoiceNo: label, reason: `invalid_type:${field}` });
        return;
      }
      const cleaned = cleanString(asString, FIELD_LIMITS[field]);
      if (cleaned !== undefined) meta[field] = cleaned;
    }

    const previous = merged.get(invoiceNo);
    if (previous) {
      duplicates++;
      merged.set(invoiceNo, { ...previous, ...meta });
    } else {
      merged.set(invoiceNo, meta);
    }
  });

  const items: RegistrationInput[] = [...merged].map(([invoiceNo, meta]) => ({
    invoiceNo,
    meta,
  }));
  return { ok: true, received: rawItems.length, items, invalid, duplicates };
}

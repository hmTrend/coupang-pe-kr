// 운송장번호 정규화/검증

const INVOICE_RE = /^\d{10,16}$/;

/**
 * 공백·하이픈을 제거하고 10~16자리 숫자인지 검사한다.
 * 유효하지 않으면 null.
 */
export function normalizeInvoiceNo(input: unknown): string | null {
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) {
    input = String(input);
  }
  if (typeof input !== "string") return null;
  // 일반 하이픈(-)과 유니코드 대시(U+2010~U+2015), 공백류 제거
  const cleaned = input.replace(/[\s\-‐-―]/g, "");
  return INVOICE_RE.test(cleaned) ? cleaned : null;
}

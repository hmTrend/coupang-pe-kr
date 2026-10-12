// 고객 문의 링크 (전화하기 / 문자보내기). 순수 함수라 서버 렌더와 테스트에서 그대로 쓴다.

/** 링크에 넣을 번호: 숫자와 맨 앞 + 만 남긴다 */
function dialable(phone: string): string {
  const trimmed = phone.trim();
  return (trimmed.startsWith("+") ? "+" : "") + trimmed.replace(/[^0-9]/g, "");
}

export function telHref(phone: string): string {
  return `tel:${dialable(phone)}`;
}

/**
 * 문자 앱을 본문이 채워진 채로 연다.
 * iOS 는 `&body=`, 안드로이드는 `?body=` 를 읽어서 둘 다 통하는 `?&body=` 형태를 쓴다.
 */
export function smsHref(phone: string, body: string): string {
  return `sms:${dialable(phone)}?&body=${encodeURIComponent(body)}`;
}

/**
 * 문자 상단에 미리 넣는 문의 머리말. 고객이 바로 아래에 내용을 이어 쓰도록 빈 줄로 끝난다.
 * 고객명은 화면에 보이는 마스킹된 이름(예: 정*보)이고, 없으면 그 줄을 뺀다.
 */
export function inquirySmsBody({ invoiceNo, customerName }: { invoiceNo: string; customerName?: string }): string {
  const lines = ["[배송문의]", `송장번호: ${invoiceNo}`];
  const name = customerName?.trim();
  if (name) lines.push(`고객명: ${name} 님`);
  return `${lines.join("\n")}\n\n`;
}

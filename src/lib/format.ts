// 화면 표시용 포맷 유틸 (서버 타임존과 무관하게 한국 시간 기준으로 표시)
import type { TrackingData } from "@/lib/deliveryTracker/types";

const KST = "Asia/Seoul";

/** "2026-10-08 18:55:06" -> { date: "2026-10-08", time: "18:55" }. 형식이 다르면 원문 그대로 */
export function splitEventTime(raw: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/.exec(raw.trim());
  return m ? { date: m[1], time: m[2] } : { date: "", time: raw };
}

/** "2026-10-08 18:55:06" -> "2026-10-08 18:55" (초 제거) */
export function shortDateTime(raw: string): string {
  const { date, time } = splitEventTime(raw);
  return date ? `${date} ${time}` : time;
}

const clockFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** ISO 시각 -> "HH:mm:ss" (KST). 잘못된 값이면 빈 문자열 */
export function formatKstClock(iso: string | Date | undefined): string {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(date.getTime()) ? "" : clockFormat.format(date);
}

const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: KST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Date -> "YYYY-MM-DD HH:mm" (KST) */
export function formatKstDateTime(date: Date | undefined | null): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  return dateTimeFormat.format(date);
}

// 호스팅 API 는 coupangls 영문 페이지를 읽는지 수령인 이름 뒤에 " sir" 를 붙여 준다 (실측 2026-10-13: "권*성 sir").
// 화면에서 " 님" 을 따로 붙이므로 호칭은 떼어 낸다. (변환 시점 map.ts 와 렌더 시점 TrackingView 가 함께 쓴다)
const RECIPIENT_HONORIFIC = /\s*(?:님|sir|ma'?am|mr\.?|ms\.?)$/i;

/** 수령인 이름 끝의 호칭(" sir", " 님" 등)을 뗀다. 이미 저장된 예전 스냅샷에도 적용할 수 있게 멱등이다 */
export function stripHonorific(name: string): string {
  return name.replace(RECIPIENT_HONORIFIC, "").trim();
}

/** 화면 상단에 크게 보여줄 현재 상태 문구 (최신 이벤트 상태 > 현재 단계 > 기본값) */
export function statusLabel(data: TrackingData): string {
  return data.latest?.status || data.currentStep || "배송 이력 없음";
}

const fullFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: KST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** epoch ms -> "YYYY-MM-DD HH:mm:ss" (KST). 값이 없으면 빈 문자열 */
export function formatKstFull(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  return fullFormat.format(new Date(ms));
}

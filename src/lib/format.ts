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

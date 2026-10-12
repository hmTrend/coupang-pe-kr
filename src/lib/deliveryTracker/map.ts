// Delivery Tracker(tracker.delivery) 응답 -> 화면용 TrackingData 변환 (순수 함수, I/O 없음)
//
// kr.coupangls 는 coupangls 모달을 그대로 옮기는 구현이라 아래 규칙을 따른다.
//  - status.name = coupangls 원문 상태 (집하, 캠프상차, 캠프도착, 배송출발, 배송완료 ...)
//  - location 은 null 이고 description = "{상태} - {위치}" (예: "집하 - 인천28HUB")
//  - time 은 RFC3339 (화면에는 KST "yyyy-MM-dd HH:mm:ss" 로 내보낸다)
import { COUPANGLS_CARRIER_ID } from "@/lib/config";
import { formatKstFull } from "@/lib/format";
import type { ApiEvent, ApiTrackInfo, TrackingData, TrackingEvent, TrackingStep } from "./types";

/** 단계바 라벨 (고정). 인덱스가 곧 진행 순서다 */
export const STEP_LABELS = ["인수", "이동", "배송지", "배송중", "배송완료"] as const;
const DELIVERED_STEP = STEP_LABELS.length - 1;

// API 가 비정상적으로 큰 값을 줘도 저장/렌더 비용이 폭주하지 않도록 상한을 둔다
const MAX_EVENTS = 100;
const MAX_LEN = { status: 80, location: 80, name: 60, address: 120 } as const;

const DESCRIPTION_SEPARATOR = " - ";

/** 연속 공백(개행 포함)을 하나로 줄이고 앞뒤를 자른 뒤 길이 상한을 적용한다 */
function squash(text: string | null | undefined, max: number): string {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** status.name 이 비었을 때 쓰는 코드별 한국어 라벨 */
const CODE_LABELS: Readonly<Record<string, string>> = {
  INFORMATION_RECEIVED: "운송장 등록",
  AT_PICKUP: "집하",
  IN_TRANSIT: "이동중",
  OUT_FOR_DELIVERY: "배송출발",
  ATTEMPT_FAIL: "배송실패",
  DELIVERED: "배송완료",
  AVAILABLE_FOR_PICKUP: "수령 가능",
  EXCEPTION: "배송 예외",
  UNKNOWN: "상태 확인중",
};

/** status.name(공백 제거) -> 단계 인덱스. 이름으로 정할 수 있으면 코드보다 우선한다 */
const STEP_BY_NAME: Readonly<Record<string, number>> = {
  운송장등록: 0,
  택배접수: 0,
  집하: 0,
  캠프상차: 1,
  소터분류: 1,
  센터상차: 1,
  센터도착: 1,
  캠프도착: 2,
  배송출발: 3,
  배송완료: 4,
};

/** status.code -> 단계 인덱스. UNKNOWN/EXCEPTION 은 단계를 바꾸지 않는다 */
const STEP_BY_CODE: Readonly<Record<string, number>> = {
  INFORMATION_RECEIVED: 0,
  AT_PICKUP: 0,
  IN_TRANSIT: 1,
  OUT_FOR_DELIVERY: 3,
  ATTEMPT_FAIL: 3,
  AVAILABLE_FOR_PICKUP: 3,
  DELIVERED: 4,
};

function stepByName(name: string | null | undefined): number | null {
  if (typeof name !== "string") return null;
  const key = name.replace(/\s+/g, "");
  if (Object.hasOwn(STEP_BY_NAME, key)) return STEP_BY_NAME[key];
  // 공항/통관 계열(해외 발송 구간)은 모두 이동 단계
  if (key.includes("공항") || key.includes("통관")) return 1;
  return null;
}

function stepByCode(code: string | null | undefined): number | null {
  return typeof code === "string" && Object.hasOwn(STEP_BY_CODE, code) ? STEP_BY_CODE[code] : null;
}

/** 이벤트 1건이 가리키는 단계 인덱스. 알 수 없으면 null */
function eventStep(event: ApiEvent): number | null {
  return stepByName(event.status?.name) ?? stepByCode(event.status?.code);
}

// 호스팅 API 는 coupangls 영문 페이지를 읽는지 수령인 이름 뒤에 " sir" 를 붙여 준다 (실측 2026-10-13: "권*성 sir").
// 화면에서 " 님" 을 따로 붙이므로 호칭은 떼어 낸다.
const RECIPIENT_HONORIFIC = /\s*(?:님|sir|ma'?am|mr\.?|ms\.?)$/i;

/** 수령인 이름에서 끝의 호칭을 뗀다 */
function recipientName(name: string | null | undefined): string {
  return squash(name, MAX_LEN.name).replace(RECIPIENT_HONORIFIC, "").trim();
}

/** "{상태} - {위치}" 의 위치. 구분자가 없으면 location.name, 둘 다 없으면 빈 문자열 */
function eventLocation(event: ApiEvent): string {
  const description = typeof event.description === "string" ? event.description : "";
  const at = description.indexOf(DESCRIPTION_SEPARATOR);
  if (at >= 0) {
    const fromDescription = squash(description.slice(at + DESCRIPTION_SEPARATOR.length), MAX_LEN.location);
    if (fromDescription) return fromDescription;
  }
  return squash(event.location?.name, MAX_LEN.location);
}

/** RFC3339 -> KST "yyyy-MM-dd HH:mm:ss". 해석할 수 없으면 빈 문자열 */
function eventTime(time: string | null | undefined): string {
  if (typeof time !== "string") return "";
  const ms = Date.parse(time);
  return Number.isNaN(ms) ? "" : formatKstFull(ms);
}

function mapEvent(event: ApiEvent): TrackingEvent {
  const name = squash(event.status?.name, MAX_LEN.status);
  const code = event.status?.code;
  return {
    time: eventTime(event.time),
    location: eventLocation(event),
    status: name || (typeof code === "string" ? (CODE_LABELS[code] ?? "") : ""),
  };
}

export interface MapContext {
  /** 정규화된 운송장번호 */
  invoiceNo: string;
  carrierId: string;
}

export function mapTrackInfo(track: ApiTrackInfo, ctx: MapContext): TrackingData {
  const edges = Array.isArray(track.events?.edges) ? track.events.edges : [];
  const nodes = edges
    .map((edge) => edge?.node)
    .filter((node): node is ApiEvent => typeof node === "object" && node !== null)
    .slice(-MAX_EVENTS);

  // lastEvent 는 이상 순서(배송완료 뒤에 다른 이벤트가 등록된 경우)에서도 DELIVERED 를 우선한다
  const last = track.lastEvent ?? nodes.at(-1) ?? null;
  const delivered = last?.status?.code === "DELIVERED";

  // 가장 진행된 이벤트 기준으로 현재 단계를 정한다 (마지막 행이 이전 단계로 돌아가 있어도 후퇴하지 않음)
  let current = -1;
  for (const event of track.lastEvent ? [...nodes, track.lastEvent] : nodes) {
    current = Math.max(current, eventStep(event) ?? -1);
  }
  if (delivered) current = DELIVERED_STEP;

  const steps: TrackingStep[] = STEP_LABELS.map((label, i) => ({ label, active: i <= current }));

  const recipient = recipientName(track.recipient?.name);
  const recipientAddress = squash(track.recipient?.location?.name, MAX_LEN.address);

  return {
    invoiceNo: ctx.invoiceNo,
    steps,
    currentStep: current >= 0 ? STEP_LABELS[current] : null,
    events: nodes.map(mapEvent),
    latest: last ? mapEvent(last) : null,
    delivered,
    recipient: recipient || recipientAddress ? { name: recipient, address: recipientAddress } : null,
    courier:
      ctx.carrierId === COUPANGLS_CARRIER_ID
        ? { name: "Coupang Logistics Services", phone: "1544-9898", invoiceNo: ctx.invoiceNo }
        : { name: ctx.carrierId, phone: "", invoiceNo: ctx.invoiceNo },
  };
}

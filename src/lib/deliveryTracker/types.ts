// Delivery Tracker 조회 결과 타입 (I/O 없는 순수 타입)
// TrackingData 계열은 화면·저장소(스냅샷)가 공유하는 형태다. 필드를 바꾸면 저장된 스냅샷과 호환이 깨진다.

export interface TrackingStep {
  label: string;
  active: boolean;
}

export interface TrackingEvent {
  /** "2026-10-08 18:55:06" (KST 기준, 24시간제) */
  time: string;
  location: string;
  status: string;
}

export interface TrackingRecipient {
  /** 마스킹된 이름 (예: "이*화"). 화면에서 " 님"을 붙여 표시한다 */
  name: string;
  /** 마스킹/축약된 지역. 없으면 빈 문자열 */
  address: string;
}

export interface TrackingCourier {
  name: string;
  phone: string;
  invoiceNo: string;
}

export interface TrackingData {
  invoiceNo: string;
  /** 단계바 (인수/이동/배송지/배송중/배송완료) */
  steps: TrackingStep[];
  /** active 인 마지막 단계의 라벨. 아직 단계를 알 수 없으면 null */
  currentStep: string | null;
  /** 시간 오름차순 (오래된 것이 먼저) */
  events: TrackingEvent[];
  /** 가장 최근 상태. API 의 lastEvent 우선 (없으면 events 의 마지막) */
  latest: TrackingEvent | null;
  delivered: boolean;
  recipient: TrackingRecipient | null;
  courier: TrackingCourier | null;
}

/** 업스트림 호출 실패 사유. 서버 로그/저장소(lastError)에만 쓰고 고객 화면·공개 API 에는 일반화해서 내보낸다 */
export type UpstreamErrorReason =
  /** 자격증명(Client Id/Secret)이 설정되지 않음 */
  | "not_configured"
  /** 인증 실패 (FORBIDDEN, UNAUTHENTICATED, HTTP 401/403) */
  | "auth"
  /** 호출 제한 (HTTP 429 등). 일정 시간 전역 백오프 */
  | "rate_limited"
  | "timeout"
  | "network"
  /** HTTP 5xx, INTERNAL, 알 수 없는 GraphQL 오류 */
  | "server_error"
  /** BAD_REQUEST 등 요청 자체가 거절됨 */
  | "bad_request"
  /** 응답이 JSON/예상 구조가 아님 */
  | "invalid_response";

export type UpstreamResult =
  | { kind: "ok"; data: TrackingData }
  | { kind: "not_found" }
  | { kind: "error"; reason: UpstreamErrorReason };

// ---- GraphQL 응답 원형 (호스팅 API 가 필드를 비워 보낼 수 있어 전부 nullable/optional 로 둔다) ----

export interface ApiLocation {
  name?: string | null;
}

export interface ApiEvent {
  /** RFC3339 */
  time?: string | null;
  status?: { code?: string | null; name?: string | null } | null;
  description?: string | null;
  location?: ApiLocation | null;
}

export interface ApiTrackInfo {
  trackingNumber?: string | null;
  lastEvent?: ApiEvent | null;
  events?: { edges?: Array<{ node?: ApiEvent | null } | null> | null } | null;
  recipient?: { name?: string | null; location?: ApiLocation | null } | null;
}

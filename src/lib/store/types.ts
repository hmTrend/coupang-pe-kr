// 저장소 추상화: 인터페이스와 문서 타입
import type { TrackingData } from "@/lib/deliveryTracker/types";

export interface InvoiceMeta {
  orderId?: string;
  productName?: string;
  receiverName?: string;
  /** NSV 가 보낸 주문 시각 문자열 (그대로 보관) */
  orderedAt?: string;
  memo?: string;
}

export type SnapshotKind = "ok" | "not_found";

export interface InvoiceDoc {
  /** 운송장번호 */
  _id: string;
  /** NSV 수집 API 로 등록된 번호인지 (조회만 된 번호는 false) */
  registered: boolean;
  operator?: string;
  meta?: InvoiceMeta;
  registeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** 마지막으로 성공한 조회 결과 (kind === 'ok' 일 때만) */
  snapshot: TrackingData | null;
  snapshotKind: SnapshotKind | null;
  snapshotAt: Date | null;
  /** not_found 스냅샷일 때의 안내 문구 */
  notFound?: { title: string; message: string };
  delivered: boolean;
  lastAttemptAt?: Date;
  lastError?: string;
}

export type SnapshotInput =
  | { kind: "ok"; data: TrackingData }
  | { kind: "not_found"; title: string; message: string };

export interface RegistrationInput {
  invoiceNo: string;
  /** 값이 있는 필드만 담는다 (없는 필드는 기존 값을 건드리지 않음) */
  meta: InvoiceMeta;
}

export interface UpsertResult {
  /** 새로 등록된 건수 (조회만 되어 있던 번호가 등록으로 전환된 경우 포함) */
  upserted: number;
  /** 이미 등록되어 있어 meta 만 갱신된 건수 */
  updated: number;
}

export interface ListQuery {
  /** 운송장번호 / 상품명 / 주문번호 부분일치 검색어 */
  q?: string;
  /** 1부터 시작 */
  page: number;
  pageSize: number;
}

export interface ListResult {
  items: InvoiceDoc[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InvoiceStore {
  get(invoiceNo: string): Promise<InvoiceDoc | null>;
  /** 번호 기준 멱등 upsert. 이미 등록된 건은 meta 만 갱신하고 registeredAt 을 유지한다 */
  upsertRegistrations(
    items: RegistrationInput[],
    operator: string,
    now: Date,
  ): Promise<UpsertResult>;
  /** 조회 성공(ok/not_found) 결과 저장. 문서가 없으면 registered:false 로 생성 */
  saveSnapshot(invoiceNo: string, input: SnapshotInput, now: Date): Promise<void>;
  /** 조회 실패 기록. 기존 스냅샷은 건드리지 않는다 */
  saveAttemptError(invoiceNo: string, error: string, now: Date): Promise<void>;
  /** 등록된 번호 목록 (최신 등록순) */
  listRegistered(query: ListQuery): Promise<ListResult>;
}

// 테스트용 픽스처 로더. 픽스처는 kr.coupangls 매핑 규칙으로 만든 Delivery Tracker GraphQL 응답 JSON 이다.
// (이전 실데이터 10332152871106: 집하 -> 캠프상차 -> 캠프도착 -> 배송출발 -> 배송완료, 수령인 "이*화")
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapTrackInfo } from "../map";
import type { ApiTrackInfo, TrackingData } from "../types";

export const FIXTURE_INVOICE_NO = "10332152871106";

export type FixtureName =
  | "delivered"
  | "out-for-delivery"
  | "in-transit"
  | "picked-up"
  | "empty-events"
  | "not-found"
  | "forbidden";

/** GraphQL 응답 전체 ({ data, errors }) */
export function loadGraphql(name: FixtureName): { data?: { track: ApiTrackInfo | null }; errors?: unknown[] } {
  return JSON.parse(readFileSync(join(__dirname, `${name}.json`), "utf-8"));
}

export function loadTrackInfo(name: FixtureName): ApiTrackInfo {
  const track = loadGraphql(name).data?.track;
  if (!track) throw new Error(`픽스처 ${name} 에 track 이 없습니다`);
  return track;
}

export function loadTrackingData(name: FixtureName, carrierId = "kr.coupangls"): TrackingData {
  return mapTrackInfo(loadTrackInfo(name), { invoiceNo: FIXTURE_INVOICE_NO, carrierId });
}

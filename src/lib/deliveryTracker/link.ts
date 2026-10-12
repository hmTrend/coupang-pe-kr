// Delivery Tracker Tracking Link: 조회 API 가 안 될 때 고객에게 보조로 보여주는 외부 배송조회 페이지 주소
// 링크형은 Client Id 만 쓰는 공식 방식이다. Client Secret 은 절대 URL 에 넣지 않는다.
import { deliveryTrackerConfig, type DeliveryTrackerConfig } from "@/lib/config";

export const TRACKING_LINK_BASE = "https://link.tracker.delivery/track";

/** Client Id 가 없으면 null (버튼을 숨긴다) */
export function trackingLinkUrl(
  invoiceNo: string,
  cfg: Pick<DeliveryTrackerConfig, "clientId" | "carrierId"> = deliveryTrackerConfig(),
): string | null {
  if (!cfg.clientId) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    carrier_id: cfg.carrierId,
    tracking_number: invoiceNo,
  });
  return `${TRACKING_LINK_BASE}?${params.toString()}`;
}

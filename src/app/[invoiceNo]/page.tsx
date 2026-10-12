import type { Metadata } from "next";
import { cache } from "react";
import Shell from "@/components/Shell";
import TrackingView from "@/components/TrackingView";
import { trackingLinkUrl } from "@/lib/deliveryTracker/link";
import { shortDateTime, statusLabel } from "@/lib/format";
import { safeDecode } from "@/lib/params";
import { getTracking, type TrackingResult } from "@/lib/tracking";

// 항상 요청 시점에 렌더링 (스냅샷 캐시는 getTracking 안에서 관리)
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ invoiceNo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// generateMetadata 와 본문이 같은 요청 안에서 업스트림/DB 를 두 번 부르지 않게 결과를 공유한다
const loadTracking = cache((invoiceNo: string, refresh: boolean) =>
  getTracking(invoiceNo, { forceRefresh: refresh }),
);

async function resolve(props: Props): Promise<TrackingResult> {
  const [{ invoiceNo }, search] = await Promise.all([props.params, props.searchParams]);
  return loadTracking(safeDecode(invoiceNo), search.refresh === "1");
}

function describe(result: TrackingResult): { title: string; description: string } {
  switch (result.status) {
    case "ok": {
      const data = result.data;
      if (!data) break;
      const status = statusLabel(data);
      const parts = [status];
      if (data.latest?.time) parts.push(shortDateTime(data.latest.time));
      if (data.latest?.location) parts.push(data.latest.location);
      return {
        title: `배송조회 ${result.invoiceNo} · ${status}`,
        description: parts.join(" · "),
      };
    }
    case "not_found":
      return {
        title: `배송조회 ${result.invoiceNo} · 검색결과 없음`,
        description: `${result.notFound?.title ?? "검색결과가 없습니다."} ${result.notFound?.message ?? ""}`.trim(),
      };
    case "invalid":
      return { title: "배송조회", description: "올바른 운송장번호가 아닙니다." };
    default:
      break;
  }
  return {
    title: `배송조회 ${result.invoiceNo}`,
    description: "일시적으로 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const result = await resolve(props);
  const { title, description } = describe(result);
  return {
    title,
    description,
    // 운송장 페이지는 검색엔진에 노출하지 않는다
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "website", locale: "ko_KR" },
  };
}

export default async function TrackingPage(props: Props) {
  const result = await resolve(props);
  // 조회가 안 될 때만 쓰는 보조 링크 (Client Id 만 사용, Secret 은 쓰지 않는다)
  const fallbackLink = result.status === "unavailable" ? trackingLinkUrl(result.invoiceNo) : null;
  return (
    <Shell>
      <TrackingView result={result} fallbackLink={fallbackLink} />
    </Shell>
  );
}

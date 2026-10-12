// 실제 Delivery Tracker Tracking API 에 운송장 1건을 조회해 매핑 결과를 출력한다.
// 사용: npx tsx scripts/smoke.ts <운송장번호>   (npm run smoke -- <운송장번호>)
//
// DELIVERY_TRACKER_CLIENT_ID / DELIVERY_TRACKER_CLIENT_SECRET 이 필요하다 (.env.local 이 있으면 읽는다).
// 실제 API 호출이므로 쿼터가 소모된다. 반복 실행하지 말 것. Client Secret 은 출력하지 않는다.
import { DeliveryTrackerClient } from "../src/lib/deliveryTracker/client";
import { deliveryTrackerConfig } from "../src/lib/config";
import { normalizeInvoiceNo } from "../src/lib/invoiceNo";

// 서버(Next)와 같은 파일에서 자격증명을 읽는다. 이미 설정된 환경변수는 덮어쓰지 않는다.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없으면 셸 환경변수만 쓴다
}

async function main(): Promise<void> {
  const invoiceNo = normalizeInvoiceNo(process.argv[2]);
  if (!invoiceNo) {
    console.error("사용법: npx tsx scripts/smoke.ts <운송장번호(숫자 10~16자리)>");
    process.exit(2);
  }

  const cfg = deliveryTrackerConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    console.error(
      [
        "[smoke] Delivery Tracker 자격증명이 없습니다.",
        "  https://console.tracker.delivery 에서 Client Id / Client Secret 을 발급받아",
        "  .env.local 에 DELIVERY_TRACKER_CLIENT_ID, DELIVERY_TRACKER_CLIENT_SECRET 으로 넣은 뒤 다시 실행하세요.",
      ].join("\n"),
    );
    process.exit(2);
  }

  console.log(`[smoke] 조회 시작: ${invoiceNo} (택배사 ${cfg.carrierId}, 엔드포인트 ${cfg.endpoint})`);
  const started = Date.now();
  const result = await new DeliveryTrackerClient().fetchTrack(invoiceNo);
  console.log(`[smoke] 결과: ${result.kind} (${Date.now() - started}ms)`);

  switch (result.kind) {
    case "ok": {
      const d = result.data;
      console.log(`  현재 단계 : ${d.currentStep ?? "-"}`);
      console.log(`  배송완료  : ${d.delivered}`);
      console.log(`  단계      : ${d.steps.map((s) => `${s.label}${s.active ? "(●)" : "(○)"}`).join(" → ")}`);
      console.log(`  최신 이벤트: ${d.latest ? `${d.latest.time} | ${d.latest.location} | ${d.latest.status}` : "-"}`);
      console.log(`  이동내역  : ${d.events.length}건`);
      for (const e of d.events) console.log(`    ${e.time} | ${e.location || "-"} | ${e.status || "-"}`);
      console.log(`  수령인    : ${d.recipient ? `${d.recipient.name} / ${d.recipient.address || "-"}` : "-"}`);
      console.log(`  택배사    : ${d.courier ? `${d.courier.name} / ${d.courier.phone || "-"} / ${d.courier.invoiceNo}` : "-"}`);
      break;
    }
    case "not_found":
      console.log("  운송장 정보를 찾을 수 없습니다 (미등록이거나 아직 집하 전).");
      break;
    case "error":
      console.log(`  오류 사유: ${result.reason}`);
      break;
  }

  process.exit(result.kind === "error" ? 1 : 0);
}

main().catch((error) => {
  console.error("[smoke] 예기치 않은 오류:", error);
  process.exit(1);
});

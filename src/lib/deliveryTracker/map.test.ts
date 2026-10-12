import { describe, expect, it } from "vitest";
import { FIXTURE_INVOICE_NO, loadTrackInfo, loadTrackingData } from "./__fixtures__/load";
import { mapTrackInfo } from "./map";
import type { ApiEvent, ApiTrackInfo } from "./types";

const activeLabels = (steps: { label: string; active: boolean }[]) =>
  steps.filter((s) => s.active).map((s) => s.label);

/** 이름·코드로 이벤트 하나를 만든다 (시간은 순서대로 1분씩) */
function event(name: string | null, code: string, i = 0, description?: string | null): ApiEvent {
  return {
    time: `2026-10-08T10:${String(i).padStart(2, "0")}:00+09:00`,
    status: { code, name },
    description: description === undefined ? (name ? `${name} - 일산5` : null) : description,
    location: null,
  };
}

function track(events: ApiEvent[], lastEvent?: ApiEvent | null): ApiTrackInfo {
  return {
    trackingNumber: FIXTURE_INVOICE_NO,
    lastEvent: lastEvent === undefined ? (events.at(-1) ?? null) : lastEvent,
    events: { edges: events.map((node) => ({ node })) },
    recipient: null,
  };
}

const map = (t: ApiTrackInfo, carrierId = "kr.coupangls") =>
  mapTrackInfo(t, { invoiceNo: FIXTURE_INVOICE_NO, carrierId });

describe("배송완료 (실데이터 10332152871106)", () => {
  const data = loadTrackingData("delivered");

  it("이벤트는 시간 오름차순이고 시각은 KST yyyy-MM-dd HH:mm:ss 문자열이다", () => {
    expect(data.events).toEqual([
      { time: "2026-10-08 08:34:22", location: "인천28HUB", status: "집하" },
      { time: "2026-10-08 09:44:07", location: "인천28HUB", status: "캠프상차" },
      { time: "2026-10-08 13:19:40", location: "일산5", status: "캠프도착" },
      { time: "2026-10-08 15:17:45", location: "일산5", status: "배송출발" },
      { time: "2026-10-08 18:55:06", location: "일산5", status: "배송완료" },
    ]);
  });

  it("단계바 5개가 모두 활성이고 현재 단계는 배송완료", () => {
    expect(data.steps.map((s) => s.label)).toEqual(["인수", "이동", "배송지", "배송중", "배송완료"]);
    expect(data.steps.every((s) => s.active)).toBe(true);
    expect(data.currentStep).toBe("배송완료");
    expect(data.delivered).toBe(true);
  });

  it("latest 는 lastEvent, 수령인·택배사는 고정값/마스킹 원문", () => {
    expect(data.latest).toEqual({ time: "2026-10-08 18:55:06", location: "일산5", status: "배송완료" });
    expect(data.invoiceNo).toBe(FIXTURE_INVOICE_NO);
    // recipient.location 이 null 이면 주소는 빈 문자열 (화면에서 그 줄을 숨긴다)
    expect(data.recipient).toEqual({ name: "이*화", address: "" });
    expect(data.courier).toEqual({
      name: "Coupang Logistics Services",
      phone: "1544-9898",
      invoiceNo: FIXTURE_INVOICE_NO,
    });
  });

  it("시각은 서버 타임존과 무관하게 KST 로 바뀐다 (UTC 입력)", () => {
    const t = track([event("집하", "IN_TRANSIT")]);
    t.events!.edges![0]!.node!.time = "2026-10-08T00:30:05Z"; // KST 09:30:05
    t.lastEvent = t.events!.edges![0]!.node;
    expect(map(t).events[0].time).toBe("2026-10-08 09:30:05");
  });
});

describe("배송중 / 집하만 / 이동", () => {
  it("배송출발까지: 4단계 활성, 현재 단계 배송중, 배송완료 아님", () => {
    const data = loadTrackingData("out-for-delivery");
    expect(activeLabels(data.steps)).toEqual(["인수", "이동", "배송지", "배송중"]);
    expect(data.currentStep).toBe("배송중");
    expect(data.delivered).toBe(false);
    expect(data.latest?.status).toBe("배송출발");
  });

  it("집하만 있으면 인수 단계만 활성", () => {
    const data = loadTrackingData("picked-up");
    expect(activeLabels(data.steps)).toEqual(["인수"]);
    expect(data.currentStep).toBe("인수");
    expect(data.events).toHaveLength(1);
    expect(data.delivered).toBe(false);
  });

  it("캠프상차까지: 이동 단계", () => {
    const data = loadTrackingData("in-transit");
    expect(activeLabels(data.steps)).toEqual(["인수", "이동"]);
    expect(data.currentStep).toBe("이동");
  });
});

describe("이벤트가 없을 때", () => {
  const data = loadTrackingData("empty-events");

  it("ok 데이터이지만 이력은 비어 있고 모든 단계가 비활성", () => {
    expect(data.events).toEqual([]);
    expect(data.latest).toBeNull();
    expect(data.delivered).toBe(false);
    expect(data.currentStep).toBeNull();
    expect(data.steps).toHaveLength(5);
    expect(data.steps.some((s) => s.active)).toBe(false);
    expect(data.recipient).toBeNull();
  });
});

describe("수령인 호칭", () => {
  const withRecipient = (name: string | null) => ({ ...track([event("배송완료", "DELIVERED")]), recipient: { name, location: null } });

  it("호스팅 API 가 붙이는 ' sir' 를 뗀다 (실측: '권*성 sir')", () => {
    expect(map(withRecipient("권*성 sir")).recipient).toEqual({ name: "권*성", address: "" });
  });

  it("' 님' 과 대소문자가 다른 영문 호칭도 뗀다", () => {
    expect(map(withRecipient("이*화 님")).recipient?.name).toBe("이*화");
    expect(map(withRecipient("김*찬 SIR")).recipient?.name).toBe("김*찬");
  });

  it("호칭이 없으면 그대로 두고, 호칭만 있으면 수령인을 null 로", () => {
    expect(map(withRecipient("홍*동")).recipient?.name).toBe("홍*동");
    expect(map(withRecipient("sir")).recipient).toBeNull();
  });
});

describe("위치 파싱", () => {
  it("description 의 첫 ' - ' 뒤를 위치로 쓴다 (위치에 ' - ' 가 더 있어도 보존)", () => {
    const data = map(track([event("집하", "IN_TRANSIT", 0, "집하 - 인천28HUB - 2층")]));
    expect(data.events[0].location).toBe("인천28HUB - 2층");
  });

  it("description 에 ' - ' 가 없으면 location.name 을 쓴다", () => {
    const e = event("집하", "IN_TRANSIT", 0, "집하");
    e.location = { name: "인천28HUB" };
    expect(map(track([e])).events[0].location).toBe("인천28HUB");
  });

  it("description 이 비었고 location 도 없으면 빈 문자열", () => {
    expect(map(track([event("집하", "IN_TRANSIT", 0, null)])).events[0].location).toBe("");
    expect(map(track([event("집하", "IN_TRANSIT", 0, "집하")])).events[0].location).toBe("");
  });

  it("' - ' 뒤가 비어 있으면 location.name 으로 폴백", () => {
    const e = event("집하", "IN_TRANSIT", 0, "집하 - ");
    e.location = { name: "인천28HUB" };
    expect(map(track([e])).events[0].location).toBe("인천28HUB");
  });
});

describe("상태 문구", () => {
  it("status.name 이 없으면 코드의 한국어 라벨을 쓴다", () => {
    const data = map(track([event(null, "IN_TRANSIT", 0, null), event(null, "DELIVERED", 1, null)]));
    expect(data.events.map((e) => e.status)).toEqual(["이동중", "배송완료"]);
  });

  it("알 수 없는 코드는 빈 문자열", () => {
    expect(map(track([event(null, "SOMETHING_NEW", 0, null)])).events[0].status).toBe("");
  });

  it("해석할 수 없는 시각은 빈 문자열", () => {
    const e = event("집하", "IN_TRANSIT");
    e.time = "not-a-date";
    expect(map(track([e])).events[0].time).toBe("");
  });
});

describe("lastEvent 우선", () => {
  it("lastEvent 는 DELIVERED 인데 마지막 이벤트가 다른 경우: 배송완료로 판정하고 latest 도 lastEvent", () => {
    const delivered = event("배송완료", "DELIVERED", 0);
    const after = event("배송출발", "OUT_FOR_DELIVERY", 1); // 배송완료 뒤에 이상 순서로 등록된 이벤트
    const data = map(track([delivered, after], delivered));
    expect(data.delivered).toBe(true);
    expect(data.latest?.status).toBe("배송완료");
    expect(data.currentStep).toBe("배송완료");
    expect(data.steps.every((s) => s.active)).toBe(true);
    // 타임라인(events)은 API 순서 그대로
    expect(data.events.map((e) => e.status)).toEqual(["배송완료", "배송출발"]);
  });

  it("lastEvent 가 없으면 마지막 이벤트로 판정한다", () => {
    const data = map(track([event("배송출발", "OUT_FOR_DELIVERY", 0), event("배송완료", "DELIVERED", 1)], null));
    expect(data.delivered).toBe(true);
    expect(data.latest?.status).toBe("배송완료");
  });

  it("단계는 가장 진행된 이벤트 기준이라 마지막 행이 이전 단계여도 후퇴하지 않는다", () => {
    const data = map(track([event("캠프도착", "IN_TRANSIT", 0), event("캠프상차", "IN_TRANSIT", 1)]));
    expect(data.currentStep).toBe("배송지");
    expect(data.latest?.status).toBe("캠프상차");
  });
});

describe("단계 매핑", () => {
  it.each([
    ["운송장 등록", "INFORMATION_RECEIVED", "인수"],
    ["택배접수", "IN_TRANSIT", "인수"],
    ["집하", "IN_TRANSIT", "인수"],
    ["캠프상차", "IN_TRANSIT", "이동"],
    ["소터분류", "IN_TRANSIT", "이동"],
    ["센터상차", "IN_TRANSIT", "이동"],
    ["센터도착", "IN_TRANSIT", "이동"],
    ["인천공항 도착", "IN_TRANSIT", "이동"],
    ["통관 완료", "IN_TRANSIT", "이동"],
    ["캠프도착", "IN_TRANSIT", "배송지"],
    ["배송출발", "OUT_FOR_DELIVERY", "배송중"],
    ["배송완료", "DELIVERED", "배송완료"],
  ])("이름 %s (%s) -> %s", (name, code, step) => {
    expect(map(track([event(name, code)])).currentStep).toBe(step);
  });

  it("이름이 코드와 달라도 이름이 우선한다 (name=캠프도착, code=IN_TRANSIT)", () => {
    // 코드만 보면 이동(IN_TRANSIT)이지만 이름 기준으로 배송지
    expect(map(track([event("캠프도착", "IN_TRANSIT")])).currentStep).toBe("배송지");
  });

  it.each([
    ["INFORMATION_RECEIVED", "인수"],
    ["AT_PICKUP", "인수"],
    ["IN_TRANSIT", "이동"],
    ["OUT_FOR_DELIVERY", "배송중"],
    ["ATTEMPT_FAIL", "배송중"],
    ["AVAILABLE_FOR_PICKUP", "배송중"],
    ["DELIVERED", "배송완료"],
  ])("이름으로 정할 수 없으면 코드 %s -> %s", (code, step) => {
    expect(map(track([event("알 수 없는 상태", code)])).currentStep).toBe(step);
  });

  it.each(["UNKNOWN", "EXCEPTION"])("코드 %s 는 단계를 바꾸지 않는다", (code) => {
    const data = map(track([event("집하", "IN_TRANSIT", 0), event("뭔가", code, 1)]));
    expect(data.currentStep).toBe("인수");
    expect(map(track([event("뭔가", code)])).currentStep).toBeNull();
  });
});

describe("수령인 / 택배사", () => {
  it("recipient.location.name 이 있으면 주소로 쓴다", () => {
    const t = loadTrackInfo("delivered");
    t.recipient = { name: "이*화", location: { name: "서울 은평구" } };
    expect(map(t).recipient).toEqual({ name: "이*화", address: "서울 은평구" });
  });

  it("이름도 주소도 없으면 null", () => {
    const t = loadTrackInfo("delivered");
    t.recipient = { name: null, location: null };
    expect(map(t).recipient).toBeNull();
    t.recipient = null;
    expect(map(t).recipient).toBeNull();
  });

  it("kr.coupangls 가 아니면 택배사 이름만 carrierId 로 채운다", () => {
    expect(map(loadTrackInfo("delivered"), "kr.cjlogistics").courier).toEqual({
      name: "kr.cjlogistics",
      phone: "",
      invoiceNo: FIXTURE_INVOICE_NO,
    });
  });
});

describe("방어", () => {
  it("edges 가 null 이거나 node 가 null 인 항목은 건너뛴다", () => {
    const t: ApiTrackInfo = {
      lastEvent: null,
      events: { edges: [null, { node: null }, { node: event("집하", "IN_TRANSIT") }] },
    };
    expect(map(t).events).toHaveLength(1);
    expect(map({ events: null }).events).toEqual([]);
    expect(map({}).latest).toBeNull();
  });

  it("이벤트가 100건을 넘으면 최근 100건만 쓴다", () => {
    const events = Array.from({ length: 130 }, (_, i) => event("집하", "IN_TRANSIT", i % 60));
    expect(map(track(events)).events).toHaveLength(100);
  });
});

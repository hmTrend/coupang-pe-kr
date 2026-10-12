import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadTrackingData } from "@/lib/deliveryTracker/__fixtures__/load";
import type { TrackingStep } from "@/lib/deliveryTracker/types";
import StepBar from "./StepBar";

const LABELS = ["인수", "이동", "배송지", "배송중", "배송완료"];
const steps = (...active: boolean[]): TrackingStep[] => active.map((a, i) => ({ label: LABELS[i] ?? `단계${i}`, active: a }));
const render = (s: TrackingStep[]) => renderToStaticMarkup(createElement(StepBar, { steps: s }));

const itemsOf = (html: string) => html.match(/<li[\s\S]*?<\/li>/g) ?? [];
/** li 안의 아이콘 박스(둥근 사각형) class */
const iconBoxClass = (li: string) => /<span class="([^"]*rounded-\[10px\][^"]*)"/.exec(li)?.[1] ?? "";
/** li 안의 연결선 색 (왼쪽 -> 오른쪽 순서). 값은 active / inactive */
const linesOf = (li: string) =>
  [...li.matchAll(/class="h-1\.5 flex-1 bg-step-(active|inactive)"/g)].map((m) => m[1]);
const svgsOf = (html: string) => html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];

describe("StepBar", () => {
  it("단계가 없으면 아무것도 그리지 않는다", () => {
    expect(render([])).toBe("");
  });

  it("5단계를 라벨 순서대로 그리고 남색 패널 안에 둔다", () => {
    const html = render(steps(true, true, true, false, false));
    const items = itemsOf(html);
    expect(items).toHaveLength(5);
    expect(items.map((li) => LABELS.find((l) => li.includes(`>${l}</span>`)))).toEqual(LABELS);
    expect(html).toMatch(/^<div class="(?=[^"]*\bbg-step-panel\b)(?=[^"]*\brounded-lg\b)/);
    expect(html).toContain('aria-label="배송 단계"');
    expect(html).toContain("grid-template-columns:repeat(5, minmax(0, 1fr))");
    // 360px 에서 "배송완료" 가 줄바꿈되지 않게 한다
    expect(items[4]).toContain("whitespace-nowrap");
  });

  it("활성 단계는 초록 아이콘/흰 라벨, 비활성 단계는 흐린 아이콘/라벨이다", () => {
    const items = itemsOf(render(steps(true, true, true, false, false)));
    items.forEach((li, i) => {
      const active = i < 3;
      expect(iconBoxClass(li)).toContain(active ? "bg-step-active" : "bg-step-inactive");
      expect(iconBoxClass(li)).toContain(active ? "text-white" : "text-step-muted");
      expect(li).toMatch(active ? /text-white">/ : /text-step-muted">/);
    });
    // 아이콘은 둥근 사각형이다 (원형 아님)
    for (const li of items) expect(iconBoxClass(li)).not.toContain("rounded-full");
  });

  it("aria-current=step 은 현재(마지막 활성) 단계에만 붙고 시각 배지는 없다", () => {
    const html = render(steps(true, true, true, true, false));
    const items = itemsOf(html);
    expect(items.map((li) => li.includes('aria-current="step"'))).toEqual([false, false, false, true, false]);
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).not.toContain("현재");
  });

  it("체크 표시 아이콘(단계 완료 체크)이 없다", () => {
    const html = render(steps(true, true, true, true, true));
    expect(html).not.toContain("M3.5 8.5l3 3 6-7");
    expect(html).not.toContain("rounded-full");
  });

  it("연결선은 양쪽 단계가 모두 활성일 때만 초록이다", () => {
    const items = itemsOf(render(steps(true, true, true, false, false)));
    expect(items.map(linesOf)).toEqual([
      ["active"],
      ["active", "active"],
      ["active", "inactive"],
      ["inactive", "inactive"],
      ["inactive"],
    ]);
    // 전부 활성이면 전부 초록, 전부 비활성이면 전부 비활성
    expect(itemsOf(render(steps(true, true, true, true, true))).flatMap(linesOf).every((c) => c === "active")).toBe(true);
    expect(itemsOf(render(steps(false, false, false, false, false))).flatMap(linesOf).every((c) => c === "inactive")).toBe(true);
    // 활성이 중간에 끊겨 있으면 이어 붙이지 않는다
    expect(itemsOf(render(steps(true, false, true, false, false))).map(linesOf)).toEqual([
      ["inactive"],
      ["inactive", "inactive"],
      ["inactive", "inactive"],
      ["inactive", "inactive"],
      ["inactive"],
    ]);
  });

  it("아이콘 5종은 서로 다르고 라벨 기준으로 매핑된다", () => {
    const icons = svgsOf(render(steps(true, true, true, true, true)));
    expect(icons).toHaveLength(5);
    expect(new Set(icons).size).toBe(5);
    // 외부 이미지 없이 인라인 SVG 만 쓴다
    expect(render(steps(true, true, true, true, true))).not.toContain("<img");

    // 순서가 달라도 라벨이 같으면 같은 아이콘이다 ("이동" = 트럭)
    const truckAtFirst = svgsOf(render([{ label: "이동", active: true }]))[0];
    expect(truckAtFirst).toBe(icons[1]);
  });

  it("배송중 상태(4단계 활성)는 4개만 초록이고 현재는 배송중이다", () => {
    const data = loadTrackingData("out-for-delivery");
    const html = render(data.steps);
    const items = itemsOf(html);
    const activeCount = data.steps.filter((s) => s.active).length;
    expect(activeCount).toBeGreaterThanOrEqual(3);
    expect(activeCount).toBeLessThan(5);
    expect(items.filter((li) => iconBoxClass(li).includes("bg-step-active"))).toHaveLength(activeCount);
    expect(items.filter((li) => iconBoxClass(li).includes("bg-step-inactive"))).toHaveLength(5 - activeCount);
    const current = items.find((li) => li.includes('aria-current="step"'));
    expect(current).toContain(">배송중</span>");
  });
});

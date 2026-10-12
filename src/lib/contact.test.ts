import { afterEach, describe, expect, it, vi } from "vitest";
import { contactPhone, DEFAULT_CONTACT_PHONE } from "./config";
import { inquirySmsBody, smsHref, telHref } from "./contact";

afterEach(() => vi.unstubAllEnvs());

describe("문의 연락처 링크", () => {
  it("tel: 링크는 보이는 하이픈 형식 그대로 번호만 연결한다 (국제번호 + 유지)", () => {
    expect(telHref("010-3277-0737")).toBe("tel:010-3277-0737");
    expect(telHref(" +82 10-3277-0737 ")).toBe("tel:+8210-3277-0737");
  });

  it("sms: 링크는 iOS/안드로이드 공용 ?&body= 형태이고 본문은 인코딩된다", () => {
    const href = smsHref("010-3277-0737", "송장번호: 1\n고객명: 정*보 님");
    expect(href).toBe(`sms:01032770737?&body=${encodeURIComponent("송장번호: 1\n고객명: 정*보 님")}`);
    expect(href).not.toMatch(/\s/);
  });

  it("문자 머리말: 송장번호·고객명이 맨 위에 오고 빈 줄로 끝난다", () => {
    expect(inquirySmsBody({ invoiceNo: "10332484526722", customerName: "정*보" })).toBe(
      "[배송문의]\n송장번호: 10332484526722\n고객명: 정*보 님\n\n",
    );
  });

  it("고객명이 없으면 그 줄을 뺀다", () => {
    for (const customerName of [undefined, "", "   "]) {
      expect(inquirySmsBody({ invoiceNo: "10332484526722", customerName })).toBe(
        "[배송문의]\n송장번호: 10332484526722\n\n",
      );
    }
  });
});

describe("contactPhone", () => {
  it("기본값은 010-3277-0737", () => {
    expect(DEFAULT_CONTACT_PHONE).toBe("010-3277-0737");
    expect(contactPhone()).toBe("010-3277-0737");
  });

  it("NEXT_PUBLIC_CONTACT_PHONE 으로 바꿀 수 있고, 번호 모양이 아니면 기본값", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_PHONE", " 02-123-4567 ");
    expect(contactPhone()).toBe("02-123-4567");
    for (const bad of ["", "abc", "javascript:alert(1)", "12"]) {
      vi.stubEnv("NEXT_PUBLIC_CONTACT_PHONE", bad);
      expect(contactPhone(), bad).toBe(DEFAULT_CONTACT_PHONE);
    }
  });
});

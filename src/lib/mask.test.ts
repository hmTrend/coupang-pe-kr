import { describe, expect, it } from "vitest";
import { maskAddress, maskDeliveryMessage, maskReceiverName } from "./mask";

// NSV 백엔드 마스킹의 실제 출력 (입력 -> 출력). 사이트 마스킹이 NSV 와 같은 규칙인지 확인한다.
const NSV_ADDRESS_CASES: Array<[string, string]> = [
  ["서울 노원구 상계3동 101-1203", "서울 노원구 상계3동 ****"],
  ["서울 강남구 도산대로45길 12 101동 1203호", "서울 강남구 도산대로45길 *** ***동 ****호"],
  ["충청북도 청주시 상당구 용암동 2345 지음프라자 301호", "충청북도 청주시 상당구 용암동 **** 지음프라자 ***호"],
  ["서울 종로구 종로1가 12 신림1동 을지로3가 세종대로23길 4", "서울 종로구 종로1가 *** 신림1동 을지로3가 세종대로23길 ***"],
  ["경기도 성남시 분당구 판교로 123-45 B102호", "경기도 성남시 분당구 판교로 **** B***호"],
  ["고불로 669,202동 607호", "고불로 ****동 ***호"],
  ["서울시 강남구 연락처 010-1234-5678", "서울시 강남구 연락처 ****"],
];
const NSV_MESSAGE_CASES: Array<[string, string]> = [
  ["공동현관 앞에 놔주세요", "공동현관 앞에 놔주세요"],
  ["공동현관 비번 종1234 문앞", "공동현관 비번 *** 문앞"],
  ["pw: abc 문앞", "pw: *** 문앞"],
  ["비밀번호는 #1234 입니다", "비밀번호는 **** 입니다"],
  ["비번 (1234)", "비번 (*********)"],
  ["직접 받고 부재 시 문 앞 (1234*)", "직접 받고 부재 시 문 앞 (*********)"],
  ["공동현관 비밀번호는 종소리, 문앞에 놔주세요", "공동현관 비밀번호는 종소리, 문앞에 놔주세요"],
  ["3시 이후 배송", "***시 이후 배송"],
];

describe("NSV 마스킹 실제 출력과 일치", () => {
  it.each(NSV_ADDRESS_CASES)("주소 %j -> %j (재적용해도 같다)", (input, expected) => {
    expect(maskAddress(input)).toBe(expected);
    expect(maskAddress(expected)).toBe(expected);
  });

  it.each(NSV_MESSAGE_CASES)("배송메시지 %j -> %j (재적용해도 같다)", (input, expected) => {
    expect(maskDeliveryMessage(input)).toBe(expected);
    expect(maskDeliveryMessage(expected)).toBe(expected);
  });
});

describe("maskAddress", () => {
  it("숫자 1~3자리는 ***, 4자리 이상은 **** 로 바꾸고 한글 지명·건물명은 유지한다 (쿠팡 표시 예)", () => {
    expect(maskAddress("충청북도 청주시 상당구 용암동 1234 지음프라자 101호")).toBe(
      "충청북도 청주시 상당구 용암동 **** 지음프라자 ***호",
    );
    expect(maskAddress("101동 1203호")).toBe("***동 ****호");
    expect(maskAddress("B102호")).toBe("B***호");
    expect(maskAddress("서울 은평구 연서로 12")).toBe("서울 은평구 연서로 ***");
  });

  it("행정구역·도로명에 붙은 숫자(바로 앞 글자가 한글)는 남긴다", () => {
    for (const kept of ["상계3동", "신림1동", "종로1가", "을지로3가", "도산대로45길", "서울 노원구 상계3동 신림1동 종로1가 을지로3가"]) {
      expect(maskAddress(kept), kept).toBe(kept);
    }
    expect(maskAddress("서울 노원구 상계3동 101-1203")).toBe("서울 노원구 상계3동 ****");
    expect(maskAddress("서울 강남구 도산대로45길 12 101동 1203호")).toBe("서울 강남구 도산대로45길 *** ***동 ****호");
    expect(maskAddress("충청북도 청주시 상당구 용암동 2345 지음프라자 301호")).toBe(
      "충청북도 청주시 상당구 용암동 **** 지음프라자 ***호",
    );
  });

  it("숫자로 시작하는 토큰, 영문 바로 뒤의 숫자는 가린다", () => {
    expect(maskAddress("101동")).toBe("***동");
    expect(maskAddress("1203호")).toBe("****호");
    expect(maskAddress("B102호")).toBe("B***호");
    expect(maskAddress("2345")).toBe("****");
    expect(maskAddress("123-45")).toBe("****");
    expect(maskAddress("669,202동")).toBe("****동");
    expect(maskAddress("A동 3층 12")).toBe("A동 ***층 ***");
    expect(maskAddress("B2호")).toBe("B***호");
    // 앞 글자가 공백·(·,·+ 이거나 문자열 맨 앞이면 가린다
    expect(maskAddress("용암동 (12)")).toBe("용암동 (***)");
    expect(maskAddress("용암동,12 +34")).toBe("용암동,*** +***");
  });

  it("한글 판정은 숫자 덩어리 첫 글자 바로 앞의 한 글자만 보고, 이어진 숫자열은 통째로 남긴다", () => {
    expect(maskAddress("가산로9-1")).toBe("가산로9-1");
    expect(maskAddress("가산로 9-1")).toBe("가산로 ***");
    expect(maskAddress("용암동1234")).toBe("용암동1234");
    // 한글 자모만 있는 글자(ㄱ)나 영문 뒤는 한글이 아니다
    expect(maskAddress("ㄱ12")).toBe("ㄱ***");
    expect(maskAddress("A12")).toBe("A***");
  });

  it("하이픈·쉼표로 이어진 숫자는 한 덩어리로 보고, 자릿수는 합산해서 정한다", () => {
    expect(maskAddress("용암동 12-3")).toBe("용암동 ***");
    expect(maskAddress("용암동 123-45")).toBe("용암동 ****");
    expect(maskAddress("테헤란로 1,203")).toBe("테헤란로 ****");
    // 공백으로 떨어진 숫자는 각각 가린다
    expect(maskAddress("테헤란로 123, 456호")).toBe("테헤란로 ***, ***호");
  });

  it("전화번호 010-1234-5678 은 통째로 ****", () => {
    expect(maskAddress("010-1234-5678")).toBe("****");
    expect(maskAddress("서울 강남구 (010-1234-5678)")).toBe("서울 강남구 (****)");
  });

  it("전각 숫자도 가린다", () => {
    expect(maskAddress("용암동 １２３４")).toBe("용암동 ****");
  });

  it("공백을 정리한다 (제어문자·연속 공백·앞뒤)", () => {
    expect(maskAddress("  충청북도   청주시\n상당구\t ")).toBe("충청북도 청주시 상당구");
  });

  it("빈 값은 빈 문자열", () => {
    expect(maskAddress("")).toBe("");
    expect(maskAddress("   \n ")).toBe("");
  });

  it("이미 마스킹된 값은 그대로 둔다 (멱등)", () => {
    const masked = "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호";
    expect(maskAddress(masked)).toBe(masked);
    for (const raw of [
      "충청북도 청주시 용암동 1234 지음프라자 101동 1203호",
      "서울 노원구 상계3동 101-1203",
      "서울 강남구 도산대로45길 12 101동 1203호",
      "B102호 669,202동 010-1234-5678",
    ]) {
      const once = maskAddress(raw);
      expect(maskAddress(once), raw).toBe(once);
    }
  });
});

describe("maskDeliveryMessage", () => {
  it("괄호 안 전체를 (*********) (별표 9개)로 바꾼다 (쿠팡 표시 예)", () => {
    expect(maskDeliveryMessage("직접 받고 부재 시 문 앞 (공동현관 1234)")).toBe(
      "직접 받고 부재 시 문 앞 (*********)",
    );
    // 안이 숫자가 아니어도, 길이가 달라도 같은 모양
    expect(maskDeliveryMessage("문 앞 (경비실에 맡겨 주세요)")).toBe("문 앞 (*********)");
    expect(maskDeliveryMessage("문 앞 (a)")).toBe("문 앞 (*********)");
    // 전각 괄호, 중첩, 닫히지 않은 괄호
    expect(maskDeliveryMessage("문 앞 （현관 1234）")).toBe("문 앞 (*********)");
    expect(maskDeliveryMessage("(a (b) c) 부재시")).toBe("(*********) 부재시");
    expect(maskDeliveryMessage("부재시 (경비실 1234")).toBe("부재시 (*********)");
    // 여는 괄호 없이 닫는 괄호만 있는 이모티콘은 건드리지 않는다
    expect(maskDeliveryMessage("문 앞에 놔주세요 :)")).toBe("문 앞에 놔주세요 :)");
  });

  it("괄호 밖 전화번호·숫자 덩어리를 가린다 (1~3자리 ***, 4자리 이상 ****)", () => {
    expect(maskDeliveryMessage("경비실에 맡겨 주세요 010-1234-5678")).toBe("경비실에 맡겨 주세요 ****");
    expect(maskDeliveryMessage("택배함 3번 사용")).toBe("택배함 ***번 사용");
    expect(maskDeliveryMessage("123 1234 12345")).toBe("*** **** ****");
  });

  it("#·* 가 붙은 출입 코드를 통째로 가린다", () => {
    expect(maskDeliveryMessage("문 앞 #1234")).toBe("문 앞 ****");
    expect(maskDeliveryMessage("현관 *1234# 입니다")).toBe("현관 **** 입니다");
    expect(maskDeliveryMessage("1234* 누르세요")).toBe("**** 누르세요");
    expect(maskDeliveryMessage("#12")).toBe("***");
  });

  it("숫자 코드는 키워드 뒤에 있어도 자릿수 규칙(1~3 ***, 4 이상 ****)으로 가린다", () => {
    expect(maskDeliveryMessage("비밀번호는 #1234 입니다")).toBe("비밀번호는 **** 입니다");
    expect(maskDeliveryMessage("비번 1234")).toBe("비번 ****");
    expect(maskDeliveryMessage("현관번호 777")).toBe("현관번호 ***");
    expect(maskDeliveryMessage("pw 9999")).toBe("pw ****");
    expect(maskDeliveryMessage("공동현관 비번 1234 입니다")).toBe("공동현관 비번 **** 입니다");
  });

  it("비밀번호/비번/출입번호/현관번호/공동현관/pw/password 바로 다음 토큰에 숫자·영문·#·* 가 있으면 ***", () => {
    expect(maskDeliveryMessage("비밀번호 abcd 입니다")).toBe("비밀번호 *** 입니다");
    expect(maskDeliveryMessage("출입번호 abc12 문 앞")).toBe("출입번호 *** 문 앞");
    expect(maskDeliveryMessage("공동현관 a1b2")).toBe("공동현관 ***");
    expect(maskDeliveryMessage("pw abc")).toBe("pw ***");
    expect(maskDeliveryMessage("PASSWORD hunter2 입니다")).toBe("PASSWORD *** 입니다");
    expect(maskDeliveryMessage("공동현관 비번 종1234 문앞")).toBe("공동현관 비번 *** 문앞");
    expect(maskDeliveryMessage("pw: abc 문앞")).toBe("pw: *** 문앞");
    expect(maskDeliveryMessage("비번 abc.")).toBe("비번 ***"); // 토큰 전체를 바꾼다
  });

  it("키워드 다음 토큰이 순수 한글이면 가리지 않는다", () => {
    expect(maskDeliveryMessage("공동현관 앞에 놔주세요")).toBe("공동현관 앞에 놔주세요");
    expect(maskDeliveryMessage("출입번호 가나다 문 앞")).toBe("출입번호 가나다 문 앞");
    expect(maskDeliveryMessage("공동현관문 열어주세요")).toBe("공동현관문 열어주세요");
    expect(maskDeliveryMessage("비번입니다")).toBe("비번입니다");
  });

  it("키워드에 조사(은/는/이/가)·구분자(: = -)가 붙어 있어도 건너뛰고 값만 가린다", () => {
    expect(maskDeliveryMessage("비번: abcd")).toBe("비번: ***");
    expect(maskDeliveryMessage("비번:abcd")).toBe("비번:***");
    expect(maskDeliveryMessage("비번: 1234")).toBe("비번: ****");
    expect(maskDeliveryMessage("비밀번호는 abcd입니다")).toBe("비밀번호는 ***");
    expect(maskDeliveryMessage("비번이 abc")).toBe("비번이 ***");
    expect(maskDeliveryMessage("공동현관 비번은 abc")).toBe("공동현관 비번은 ***");
    expect(maskDeliveryMessage("pw : abcd")).toBe("pw : ***");
    expect(maskDeliveryMessage("pw - abcd")).toBe("pw - ***");
    expect(maskDeliveryMessage("비번 은 : abcd")).toBe("비번 은 : ***");
    expect(maskDeliveryMessage("password=hunter2")).toBe("password=***");
  });

  it("키워드가 연달아 나오면 마지막 키워드 뒤의 토큰을 가린다", () => {
    expect(maskDeliveryMessage("공동현관 비번 abc 입니다")).toBe("공동현관 비번 *** 입니다");
    expect(maskDeliveryMessage("공동현관문 비번 abc")).toBe("공동현관문 비번 ***");
  });

  it("키워드 뒤 값이 괄호면 괄호 마스킹이 우선한다", () => {
    expect(maskDeliveryMessage("비번 (1234)")).toBe("비번 (*********)");
  });

  it("공백을 정리한다", () => {
    expect(maskDeliveryMessage("  문 앞에\n  놔주세요  ")).toBe("문 앞에 놔주세요");
  });

  it("빈 값은 빈 문자열", () => {
    expect(maskDeliveryMessage("")).toBe("");
    expect(maskDeliveryMessage("  \t ")).toBe("");
  });

  it("이미 마스킹된 값은 그대로 둔다 (멱등)", () => {
    for (const masked of [
      "직접 받고 부재 시 문 앞 (*********)",
      "경비실에 맡겨 주세요 ****",
      "공동현관 비번 *** 입니다",
      "공동현관 비번 **** 입니다",
      "비번: ***",
      "비밀번호는 **** 입니다",
      "택배함 ***번 사용",
      "***",
      "공동현관 비번 **** 문 앞",
      "공동현관 앞에 놔주세요",
    ]) {
      expect(maskDeliveryMessage(masked), masked).toBe(masked);
    }
    // 원본을 한 번 마스킹한 결과를 다시 마스킹해도 같다
    for (const raw of [
      "비번 #1234* 문 앞 (현관 5678) 010-1234-5678 3번",
      "비밀번호는 #1234 입니다",
      "공동현관 비번 종1234 문앞",
      "pw: abc 문앞",
      "비번 abc. 비번은 1234.",
      "공동현관문 비번 (abc) 7번",
    ]) {
      const once = maskDeliveryMessage(raw);
      expect(maskDeliveryMessage(once), raw).toBe(once);
    }
  });

  it("긴 별표/괄호 줄에서도 오래 걸리지 않는다 (정규식 역추적 방지)", () => {
    const started = Date.now();
    maskDeliveryMessage("*".repeat(200_000));
    maskDeliveryMessage("#".repeat(200_000) + "x");
    maskDeliveryMessage("(".repeat(200_000));
    maskDeliveryMessage("비번 " + ".".repeat(200_000) + "x");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("maskReceiverName", () => {
  it("이름에 섞인 숫자만 가리고 마스킹된 이름은 그대로 둔다", () => {
    expect(maskReceiverName("김*준")).toBe("김*준");
    expect(maskReceiverName("홍길동")).toBe("홍길동");
    expect(maskReceiverName("홍길동 010-1234-5678")).toBe("홍길동 ****");
    expect(maskReceiverName("홍길동2")).toBe("홍길동***");
    expect(maskReceiverName("  ")).toBe("");
  });

  it("멱등", () => {
    const once = maskReceiverName("홍길동 01012345678");
    expect(maskReceiverName(once)).toBe(once);
  });
});

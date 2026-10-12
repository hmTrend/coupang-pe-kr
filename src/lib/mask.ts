// 고객 화면에 나가는 주소·배송메시지 마스킹 (순수 함수, 쿠팡 주문 상세와 같은 방식).
//
// 1차 마스킹은 NSV 가 보내기 전에 같은 규칙으로 이미 한다. 여기 함수들은 NSV 가 놓친 값이
// 그대로 저장·노출되지 않게 하는 "안전망"이다(수집 API 에서 저장 직전에 한 번 더 적용).
// 그래서 모든 함수는 멱등이다: 이미 마스킹된 값을 다시 넣어도 결과가 바뀌지 않는다.
//
//   maskAddress("서울 강남구 도산대로45길 12 101동 1203호")
//     -> "서울 강남구 도산대로45길 *** ***동 ****호"
//   maskDeliveryMessage("직접 받고 부재 시 문 앞 (현관 1234) 비번 abcd")
//     -> "직접 받고 부재 시 문 앞 (*********) 비번 ***"

// NSV 쪽 마스킹과 같은 규칙이다. 숫자는 반각/전각 0-9 만 본다.

/** `-` 나 `,` 로 이어진 숫자열 전체가 한 덩어리 (전화번호 010-1234-5678, 지번 9-1, 669,202 등) */
const DIGIT_CHUNK = /[0-9０-９]+(?:[-,][0-9０-９]+)*/g;

/**
 * 배송메시지의 출입 코드: 숫자 덩어리 앞뒤에 #·* 가 붙은 것까지 한 덩어리 (#1234, *1234#, 1234*).
 * 앞의 (?<![#*]) 는 긴 별표 줄(이미 마스킹된 값 등)에서 매 위치마다 되돌아가며 훑는 것을 막는다.
 */
const CODE_CHUNK = /(?<![#*])[#*]*[0-9０-９]+(?:[-,][0-9０-９]+)*[#*]*/g;

/** 이 키워드 바로 다음 토큰을 가린다. 영문은 단어 경계를 본다(pw, password) */
const KEYWORD = /비밀번호|비번|출입번호|현관번호|공동현관|(?<![a-z])(?:password|pw)(?![a-z])/giu;

/** 키워드 뒤 토큰이 "값(코드)처럼 보이는가": 숫자·영문자·#·* 가 하나라도 있어야 한다 (순수 한글은 값이 아니다) */
const VALUE_CHAR = /[0-9０-９A-Za-z#*]/;

/** 주소에서 숫자 덩어리 바로 앞 한 글자가 한글인지 */
const HANGUL = /[가-힣]/;

const MASKED_PAREN = "(*********)";
const OPEN_PAREN = new Set(["(", "（"]);
const CLOSE_PAREN = new Set([")", "）"]);

/** 제어문자를 공백으로 바꾸고 연속 공백을 하나로 정리한다 */
function tidy(value: string): string {
  return value.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
}

/** 숫자 덩어리 하나를 대체할 별표: 숫자 1~3개는 ***, 4개 이상은 **** */
function starsFor(chunk: string): string {
  return chunk.replace(/[^0-9０-９]/g, "").length >= 4 ? "****" : "***";
}

/**
 * 수취인 주소 마스킹: 숫자 덩어리(하이픈·쉼표로 이어진 것 포함)를 별표로 바꾸고 한글 지명·건물명은 그대로 둔다.
 * 숫자가 1~3개면 `***`, 4개 이상이면 `****`.
 * 단, 숫자 덩어리 첫 글자 **바로 앞의 한 글자가 한글([가-힣])**이면 행정구역·도로명의 일부라서 덩어리 전체를 그대로 둔다
 * (상계3동, 신림1동, 종로1가, 을지로3가, 도산대로45길, 가산로9-1). 문자열 맨 앞이거나 앞 글자가 공백·영문·(·,·+ 등이면 가린다.
 *   "101동 1203호" -> "***동 ****호",  "B102호" -> "B***호",  "서울 노원구 상계3동 101-1203" -> "서울 노원구 상계3동 ****"
 */
export function maskAddress(value: string): string {
  const text = tidy(value);
  return text.replace(DIGIT_CHUNK, (chunk: string, offset: number) => {
    return offset > 0 && HANGUL.test(text[offset - 1]) ? chunk : starsFor(chunk);
  });
}

/** 수령인 이름에 숫자가 섞여 들어온 경우의 정리: 숫자는 모두 가린다 ("김*준" 같은 값은 그대로) */
export function maskReceiverName(value: string): string {
  return tidy(value).replace(DIGIT_CHUNK, starsFor);
}

/** 괄호(전각 포함)와 그 안 전체를 `(*********)` 로 바꾼다. 중첩은 바깥 괄호까지, 닫히지 않은 괄호는 끝까지 덮는다 */
function maskParentheses(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (OPEN_PAREN.has(ch)) {
      if (depth === 0) out += MASKED_PAREN;
      depth++;
    } else if (CLOSE_PAREN.has(ch) && depth > 0) {
      depth--;
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

/** 토큰 안 마지막 키워드의 끝 위치. 없으면 -1 */
function lastKeywordEnd(token: string): number {
  let end = -1;
  for (const match of token.matchAll(KEYWORD)) end = match.index + match[0].length;
  return end;
}

/** 키워드 뒤에서 가려야 하는 값인가: 숫자·영문·#·* 가 들어 있고, 별표/마스킹 괄호뿐인 토큰(****, (*********))은 이미 가려진 것이라 제외 */
function isMaskableValue(token: string): boolean {
  return VALUE_CHAR.test(token) && !/^[()*]+$/.test(token);
}

/** 키워드 바로 뒤의 조사(은/는/이/가)와 구분자(: = -): "비번은", "비번:", "비번=1234" */
const ATTACHED_PARTICLE = /^[은는이가]?[:：=\-–]*/u;
/** 값 앞에서 건너뛰는 토큰: "비번 : 1234", "비번 은 1234" */
const SKIPPED_TOKEN = /^(?:[은는이가][:：=\-–]*|[:：=\-–]+)$/u;

/**
 * 비밀번호류 키워드(비밀번호/비번/출입번호/현관번호/공동현관/pw/password) 바로 다음 토큰 하나를 `***` 로 바꾼다.
 * 조사 은/는/이/가와 `: = -` 는 건너뛰고, 다음 토큰에 숫자·영문자·#·* 가 하나라도 있을 때만 가린다(순수 한글 토큰은 남긴다).
 * 판정은 괄호·숫자 마스킹을 끝낸 값으로 하므로, 순수 숫자 코드는 이미 별표가 되어 있어 그대로 남는다.
 *   "비번 abc" -> "비번 ***",  "pw: abc" -> "pw: ***",  "공동현관 비번 종1234" -> "공동현관 비번 ***",  "공동현관 앞에 놔주세요" -> 그대로
 * 키워드가 연달아 나오면 마지막 키워드 뒤의 토큰을 가린다. 이미 별표뿐인 토큰은 건드리지 않는다.
 */
function maskKeywordValues(text: string): string {
  const tokens = text.split(" ");
  let pending = false; // 키워드를 만났고 값 토큰을 기다리는 중

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const end = lastKeywordEnd(token);

    if (end >= 0) {
      const attached = ATTACHED_PARTICLE.exec(token.slice(end))?.[0] ?? "";
      const head = token.slice(0, end + attached.length);
      const rest = token.slice(end + attached.length);
      if (rest === "") {
        pending = true;
      } else {
        // "pw:abcd" 처럼 키워드에 값이 붙은 경우. "공동현관문", "비번입니다" 같은 한글 꼬리말은 값이 아니다
        if (isMaskableValue(rest)) tokens[i] = `${head}***`;
        pending = false;
      }
    } else if (pending) {
      if (SKIPPED_TOKEN.test(token)) continue;
      if (isMaskableValue(token)) tokens[i] = "***";
      pending = false;
    }
  }
  return tokens.join(" ");
}

/**
 * 배송요청사항 마스킹 (순서대로 적용).
 *  1) 괄호 안 전체 -> `(*********)`
 *  2) 괄호 밖 숫자 덩어리와 #·* 가 붙은 코드 -> `***`(숫자 1~3개) / `****`(4개 이상)
 *  3) 비밀번호/비번/출입번호/현관번호/공동현관/pw/password 바로 다음 토큰 -> `***`
 *     (숫자·영문자·#·* 가 있는 토큰만. 2) 에서 이미 별표가 된 순수 숫자 코드는 그대로 둔다)
 *   "직접 받고 부재 시 문 앞 (공동현관 1234)" -> "직접 받고 부재 시 문 앞 (*********)"
 *   "경비실에 맡겨주세요 010-1234-5678" -> "경비실에 맡겨주세요 ****"
 *   "비밀번호는 #1234 입니다" -> "비밀번호는 **** 입니다",  "공동현관 비번 종1234 문앞" -> "공동현관 비번 *** 문앞"
 */
export function maskDeliveryMessage(value: string): string {
  const withoutParens = maskParentheses(tidy(value));
  const withoutCodes = withoutParens.replace(CODE_CHUNK, starsFor);
  return tidy(maskKeywordValues(withoutCodes));
}

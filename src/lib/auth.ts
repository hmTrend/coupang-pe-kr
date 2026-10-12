// 인증 유틸: 상수시간 비교, API 키 파싱, Basic Auth 검증
// Edge(middleware)와 Node 양쪽에서 쓰므로 node:crypto 에 의존하지 않는다.

/** 길이/내용과 무관하게 전체를 훑는 상수시간 문자열 비교 */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export interface ApiKeyEntry {
  operator: string;
  key: string;
}

/**
 * INGEST_API_KEYS="operator1:KEY1,operator2:KEY2" 파싱.
 * 첫 번째 ':' 기준으로 operator / key 를 나눈다. ':' 가 없으면 operator 는 "default".
 */
export function parseApiKeys(raw: string | undefined): ApiKeyEntry[] {
  if (!raw) return [];
  const entries: ApiKeyEntry[] = [];
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const idx = token.indexOf(":");
    const operator = idx === -1 ? "default" : token.slice(0, idx).trim() || "default";
    const key = (idx === -1 ? token : token.slice(idx + 1)).trim();
    if (key) entries.push({ operator, key });
  }
  return entries;
}

/** Authorization: Bearer <key> 또는 x-api-key 헤더에서 키를 꺼낸다 */
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const header = headers.get("x-api-key")?.trim();
  return header ? header : null;
}

/** 일치하는 키의 operator 를 반환 (모든 키를 끝까지 비교해 타이밍 차이를 줄인다) */
export function matchApiKey(entries: ApiKeyEntry[], presented: string): string | null {
  let operator: string | null = null;
  for (const entry of entries) {
    if (safeEqual(entry.key, presented) && operator === null) operator = entry.operator;
  }
  return operator;
}

export type AdminAuthResult = "ok" | "unauthorized" | "disabled";

/** 관리자 Basic Auth 검증. ADMIN_PASSWORD 미설정이면 "disabled" */
export function checkAdminAuth(authorization: string | null): AdminAuthResult {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return "disabled";
  const user = process.env.ADMIN_USER?.trim() || "admin";

  const match = authorization ? /^Basic\s+(.+)$/i.exec(authorization.trim()) : null;
  if (!match) return "unauthorized";

  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return "unauthorized";
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return "unauthorized";

  // 사용자명/비밀번호를 둘 다 비교한 뒤 결과를 합친다
  const userOk = safeEqual(decoded.slice(0, idx), user);
  const passOk = safeEqual(decoded.slice(idx + 1), password);
  return userOk && passOk ? "ok" : "unauthorized";
}

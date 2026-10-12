// URL 경로 파라미터 디코딩 (잘못된 퍼센트 인코딩이어도 예외 없이 원문을 돌려준다)
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

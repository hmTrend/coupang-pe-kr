import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const css = readFileSync(join(__dirname, "globals.css"), "utf-8");

/** :root(라이트) 블록 / 다크 미디어쿼리 블록의 토큰 값 */
const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));
const token = (block: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|svg)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("쿠팡 계열 테마 토큰", () => {
  it("라이트: 블루 primary, 레드 포인트, 중립 회색 배경/카드/글자/구분선", () => {
    expect(token(light, "--accent")).toBe("#346aff");
    expect(token(light, "--accent-hover")).toBe("#2a5be8");
    expect(token(light, "--accent-fg")).toBe("#ffffff");
    expect(token(light, "--danger")).toBe("#e52528");
    expect(token(light, "--background")).toBe("#f5f5f5");
    expect(token(light, "--card")).toBe("#ffffff");
    expect(token(light, "--foreground")).toBe("#111111");
    expect(token(light, "--muted")).toBe("#767676");
    expect(token(light, "--line")).toBe("#e5e5e5");
  });

  it("다크: 같은 블루 계열이며 글자/링크용 블루는 더 밝다", () => {
    expect(token(dark, "--accent")).toBe("#346aff");
    expect(token(dark, "--accent-text")).not.toBe(token(light, "--accent-text"));
    for (const name of ["--background", "--card", "--foreground", "--muted", "--line", "--accent-soft", "--danger"]) {
      expect(token(dark, name), name).toBeTruthy();
    }
  });

  it("단계바 토큰(남색 패널 / 초록 활성)은 다크모드에서 덮어쓰지 않는다", () => {
    expect(token(light, "--step-panel")).toBe("#34465e");
    expect(token(light, "--step-active")).toBe("#5cb46d");
    expect(token(dark, "--step-panel")).toBeUndefined();
    expect(token(dark, "--step-active")).toBeUndefined();
  });

  it("이전 틸(청록) 색이 소스에 남아 있지 않다", () => {
    const teal = /#0f766e|#2dd4bf|#e0f4f1|#11302d|#06201d|\bteal\b/i;
    const hits = sourceFiles(SRC).filter((file) => teal.test(readFileSync(file, "utf-8")));
    expect(hits).toEqual([]);
  });
});

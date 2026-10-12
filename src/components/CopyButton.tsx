"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** 복사할 텍스트 */
  text?: string;
  /** 지정하면 현재 사이트 origin 을 붙인 절대 URL 을 복사한다 (예: "/10332152871106") */
  path?: string;
  label?: string;
  className?: string;
}

export default function CopyButton({ text, path, label = "복사", className = "" }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    const value = path ? `${window.location.origin}${path}` : (text ?? "");
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard API 를 쓸 수 없는 환경(비보안 컨텍스트 등) 폴백
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(area);
      }
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={`inline-flex h-8 shrink-0 items-center rounded-md border border-line px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent-soft active:scale-[0.98] ${className}`}
    >
      {copied ? "복사됨" : label}
    </button>
  );
}

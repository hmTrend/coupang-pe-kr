"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { normalizeInvoiceNo } from "@/lib/invoiceNo";

/** 운송장번호 입력 폼. JS 가 없으면 /go?q= 로 GET 제출되어 서버가 리다이렉트한다 */
export default function InvoiceForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const target = normalizeInvoiceNo(raw) ?? raw;
    startTransition(() => router.push(`/${encodeURIComponent(target)}`));
  }

  return (
    <form action="/go" method="get" onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="invoice-q" className="sr-only">
        운송장번호
      </label>
      <input
        id="invoice-q"
        name="q"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        maxLength={40}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="운송장번호 (숫자 10~16자리)"
        className="h-14 w-full rounded-xl border border-line bg-card px-4 text-lg tabular-nums outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="h-14 w-full rounded-xl bg-accent text-base font-bold text-accent-fg transition-opacity active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? "조회 중…" : "조회하기"}
      </button>
    </form>
  );
}

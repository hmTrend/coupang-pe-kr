"use client";

import Shell from "@/components/Shell";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Shell>
      <section className="rounded-2xl border border-line bg-card p-6 text-center">
        <h1 className="text-xl font-bold">문제가 발생했어요</h1>
        <p className="mt-2 text-sm text-muted">잠시 후 다시 시도해 주세요.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 h-11 rounded-xl bg-accent px-6 text-sm font-bold text-accent-fg"
        >
          다시 시도
        </button>
      </section>
    </Shell>
  );
}

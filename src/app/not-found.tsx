import Link from "next/link";
import Shell from "@/components/Shell";

export default function NotFound() {
  return (
    <Shell>
      <section className="rounded-2xl border border-line bg-card p-6 text-center">
        <h1 className="text-xl font-bold">페이지를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-muted">주소를 다시 확인해 주세요.</p>
        <Link
          href="/"
          className="mt-5 inline-flex h-11 items-center rounded-xl bg-accent px-6 text-sm font-bold text-accent-fg"
        >
          처음으로
        </Link>
      </section>
    </Shell>
  );
}

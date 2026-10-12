import InvoiceForm from "@/components/InvoiceForm";
import Shell from "@/components/Shell";

export default function HomePage() {
  const name = process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "배송조회";
  return (
    <Shell>
      <section className="rounded-lg border border-line bg-card p-6 pt-8">
        <h1 className="text-2xl font-extrabold tracking-tight">{name}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          운송장번호를 입력하면 현재 배송 상태와 이동 내역을 바로 확인할 수 있어요.
        </p>
        <div className="mt-6">
          <InvoiceForm />
        </div>
      </section>
      <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-3 text-center text-sm leading-relaxed text-muted">
        주소 뒤에 <code className="rounded bg-card px-1 py-0.5 font-semibold text-foreground">/운송장번호</code>{" "}
        를 붙이면 바로 조회됩니다.
      </p>
    </Shell>
  );
}

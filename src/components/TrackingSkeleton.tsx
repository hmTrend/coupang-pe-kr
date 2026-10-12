/** 업스트림 조회 중에 보여주는 뼈대 화면 */
export default function TrackingSkeleton() {
  const block = "animate-pulse rounded-md bg-line";
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className={`${block} h-3 w-40`} />
        <div className={`${block} mt-4 h-8 w-32`} />
        <div className={`${block} mt-3 h-4 w-48`} />
        <div className="mt-6 flex justify-between">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={`${block} h-8 w-8 rounded-full`} />
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className={`${block} h-4 w-20`} />
        <div className={`${block} mt-5 h-10 w-full`} />
        <div className={`${block} mt-4 h-10 w-full`} />
        <div className={`${block} mt-4 h-10 w-full`} />
      </section>
      <p className="px-1 text-center text-sm text-muted">배송 정보를 조회하고 있어요…</p>
    </div>
  );
}

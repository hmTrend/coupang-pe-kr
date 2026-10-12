/** 업스트림 조회 중에 보여주는 뼈대 화면 */
export default function TrackingSkeleton() {
  const block = "animate-pulse rounded-md bg-line";
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <section className="rounded-lg border border-line bg-card p-5">
        <div className={`${block} h-8 w-32`} />
        <div className={`${block} mt-3 h-4 w-48`} />
        {/* 남색 단계바 패널 자리 (실제 StepBar 와 높이를 맞춘다) */}
        <div className="mt-5 grid grid-cols-5 rounded-lg bg-step-panel px-2 py-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="h-9 w-9 animate-pulse rounded-[10px] bg-step-inactive sm:h-10 sm:w-10" />
              <div className="mt-2 h-4 w-9 animate-pulse rounded bg-step-inactive" />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-line bg-card p-5">
        <div className={`${block} h-4 w-20`} />
        <div className={`${block} mt-5 h-10 w-full`} />
        <div className={`${block} mt-4 h-10 w-full`} />
        <div className={`${block} mt-4 h-10 w-full`} />
      </section>
      <p className="px-1 text-center text-sm text-muted">배송 정보를 조회하고 있어요…</p>
    </div>
  );
}

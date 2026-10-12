import type { TrackingStep } from "@/lib/deliveryTracker/types";

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 배송 단계바. 단계 라벨/개수는 TrackingData.steps 를 그대로 쓴다 */
export default function StepBar({ steps }: { steps: TrackingStep[] }) {
  if (steps.length === 0) return null;
  let current = -1;
  steps.forEach((s, i) => {
    if (s.active) current = i;
  });

  return (
    <ol
      className="grid"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label="배송 단계"
    >
      {steps.map((step, i) => {
        const next = steps[i + 1];
        const isCurrent = i === current;
        return (
          <li
            key={`${i}-${step.label}`}
            className="relative flex flex-col items-center text-center"
            aria-current={isCurrent ? "step" : undefined}
          >
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`absolute left-0 top-[15px] h-0.5 w-1/2 ${step.active ? "bg-accent" : "bg-line"}`}
              />
            )}
            {next && (
              <span
                aria-hidden="true"
                className={`absolute right-0 top-[15px] h-0.5 w-1/2 ${next.active ? "bg-accent" : "bg-line"}`}
              />
            )}
            <span
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                step.active
                  ? "bg-accent text-accent-fg"
                  : "border-2 border-line bg-card text-muted"
              } ${isCurrent ? "ring-4 ring-accent/25" : ""}`}
            >
              {step.active ? <CheckIcon /> : i + 1}
            </span>
            <span
              className={`mt-2 text-xs ${
                isCurrent ? "font-bold text-foreground" : step.active ? "text-foreground" : "text-muted"
              }`}
            >
              {step.label}
            </span>
            {isCurrent && (
              <span className="mt-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                현재
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

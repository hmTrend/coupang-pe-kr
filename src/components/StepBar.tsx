import type { TrackingStep } from "@/lib/deliveryTracker/types";

// 단계 아이콘 5종: 직접 그린 일반 라인 아이콘 (외부 아이콘/이미지를 가져오지 않는다)
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 인수: 체크 표시가 있는 클립보드 */
const PickupIcon = () => (
  <Svg>
    <rect x="5" y="5" width="14" height="16" rx="2" />
    <rect x="9" y="3" width="6" height="4" rx="1" />
    <path d="M9 14.2l2.4 2.4L16 12" />
  </Svg>
);

/** 이동: 트럭 */
const TruckIcon = () => (
  <Svg>
    <path d="M3 17V7.5A1.5 1.5 0 014.5 6h9v11" />
    <path d="M13.5 9.5h4L21 13v4" />
    <path d="M3 17h2M9 17h6M19 17h2" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </Svg>
);

/** 배송지: 깃발 */
const FlagIcon = () => (
  <Svg>
    <path d="M6 21V4" />
    <path d="M6 5h11l-2.5 3.5L17 12H6" />
  </Svg>
);

/** 배송중: 로켓 */
const RocketIcon = () => (
  <Svg>
    <path d="M12 3c3 2 5 5.5 5 9.5l-2 3H9l-2-3C7 8.5 9 5 12 3z" />
    <circle cx="12" cy="9.5" r="1.6" />
    <path d="M7.7 13.5L5 16l2.7.7M16.3 13.5L19 16l-2.7.7M10.5 18.5L12 21l1.5-2.5" />
  </Svg>
);

/** 배송완료: 결승선 깃발 */
const FinishFlagIcon = () => (
  <Svg>
    <path d="M6 21V3" />
    <path d="M6 4h12v9H6" />
    <path d="M10 4v9M14 4v9M6 8.5h12" />
  </Svg>
);

const ICON_BY_LABEL: Record<string, () => React.ReactElement> = {
  인수: PickupIcon,
  이동: TruckIcon,
  배송지: FlagIcon,
  배송중: RocketIcon,
  배송완료: FinishFlagIcon,
};
// 라벨이 달라져도 위치(인덱스) 기준으로 아이콘을 고른다
const ICON_ORDER = [PickupIcon, TruckIcon, FlagIcon, RocketIcon, FinishFlagIcon];

/**
 * 배송 단계바 (남색 패널 + 둥근 사각형 아이콘 + 초록 연결선).
 * 단계 라벨/개수는 TrackingData.steps 를 그대로 쓴다. 현재 단계는 시각 배지 없이 aria-current 로만 표시한다.
 */
export default function StepBar({ steps }: { steps: TrackingStep[] }) {
  if (steps.length === 0) return null;
  let current = -1;
  steps.forEach((s, i) => {
    if (s.active) current = i;
  });

  // 두 단계가 모두 활성일 때만 초록 연결선
  const lineColor = (a: TrackingStep | undefined, b: TrackingStep | undefined) =>
    a?.active && b?.active ? "bg-step-active" : "bg-step-inactive";

  return (
    <div className="rounded-lg bg-step-panel px-2 py-4">
      <ol
        className="grid"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        aria-label="배송 단계"
      >
        {steps.map((step, i) => {
          const prev = steps[i - 1];
          const next = steps[i + 1];
          const Icon = ICON_BY_LABEL[step.label] ?? ICON_ORDER[i] ?? FlagIcon;
          return (
            <li
              key={`${i}-${step.label}`}
              className="flex flex-col items-center"
              aria-current={i === current ? "step" : undefined}
            >
              {/* 연결선은 아이콘 사이 빈 공간에만 그린다 (반투명 아이콘 배경 뒤로 비치지 않게) */}
              <div className="flex w-full items-center">
                {prev ? (
                  <span aria-hidden="true" className={`h-1.5 flex-1 ${lineColor(prev, step)}`} />
                ) : (
                  <span className="flex-1" />
                )}
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] sm:h-10 sm:w-10 ${
                    step.active ? "bg-step-active text-white" : "bg-step-inactive text-step-muted"
                  }`}
                >
                  <Icon />
                </span>
                {next ? (
                  <span aria-hidden="true" className={`h-1.5 flex-1 ${lineColor(step, next)}`} />
                ) : (
                  <span className="flex-1" />
                )}
              </div>
              <span
                className={`mt-2 whitespace-nowrap text-xs font-bold ${step.active ? "text-white" : "text-step-muted"}`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

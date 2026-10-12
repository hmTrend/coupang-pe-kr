import type { TrackingEvent } from "@/lib/deliveryTracker/types";
import { splitEventTime } from "@/lib/format";

/**
 * 이동 내역 표 (시간 | 현재위치 | 배송상태).
 * events 는 시간 오름차순이라 모달처럼 오래된 것이 위, 최신(마지막 행)이 아래로 오며 마지막 행만 굵게 보여준다.
 * 시간 칸은 날짜/시각을 두 줄로 나눠 좁은 폭(360px)에서도 가로 스크롤이 생기지 않게 한다.
 */
export default function EventTable({ events }: { events: TrackingEvent[] }) {
  if (events.length === 0) {
    return <p className="py-2 text-sm text-muted">아직 배송 이력이 없습니다.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-xs text-muted">
          <th scope="col" className="w-[1%] whitespace-nowrap py-2 pr-3 text-left font-medium">
            시간
          </th>
          <th scope="col" className="py-2 pr-3 text-left font-medium">
            현재위치
          </th>
          <th scope="col" className="py-2 text-left font-medium">
            배송상태
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {events.map((event, i) => {
          const isLatest = i === events.length - 1;
          const { date, time } = splitEventTime(event.time);
          return (
            <tr key={`${event.time}-${i}`} className={isLatest ? "font-bold" : undefined}>
              <td className="whitespace-nowrap py-2.5 pr-3 align-top tabular-nums">
                {date && <span className="block text-xs text-muted">{date}</span>}
                <span className="block">{time}</span>
              </td>
              <td className="py-2.5 pr-3 align-top">{event.location || "-"}</td>
              <td className="py-2.5 align-top">{event.status || "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

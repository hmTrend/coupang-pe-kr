import type { TrackingData } from "@/lib/deliveryTracker/types";
import { formatKstClock, formatKstDateTime, shortDateTime, statusLabel, stripHonorific } from "@/lib/format";
import type { TrackingResult } from "@/lib/tracking";
import EventTable from "./EventTable";
import InvoiceForm from "./InvoiceForm";
import StepBar from "./StepBar";

const card = "rounded-lg border border-line bg-card p-5";

function RefreshLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    // 서버 렌더 + 일반 링크라 JS 없이도 동작한다
    <a
      href={href}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-accent px-3.5 text-sm font-bold text-accent-text transition-colors hover:bg-accent-soft"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
        <path
          d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v3h-3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </a>
  );
}

function StaleBanner() {
  return (
    <div
      role="status"
      className="rounded-lg border border-warn-line bg-warn-bg px-4 py-3 text-sm leading-relaxed text-warn-fg"
    >
      실시간 조회가 잠시 지연되어 마지막으로 확인한 정보를 보여드려요
    </div>
  );
}

function CourierRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row" className="w-20 py-2.5 pr-3 text-left align-top font-normal text-muted">
        {label}
      </th>
      <td className="py-2.5 align-top tabular-nums">{children}</td>
    </tr>
  );
}

function OkView({ result, data }: { result: TrackingResult; data: TrackingData }) {
  const { latest, recipient, courier } = data;
  const invoiceNo = courier?.invoiceNo || data.invoiceNo;
  // 예전에 저장된 스냅샷에는 " sir" 같은 호칭이 남아 있을 수 있어 렌더 시점에도 한 번 더 뗀다
  const recipientName = stripHonorific(recipient?.name ?? "");
  const hasRecipient = Boolean(recipientName || recipient?.address);
  const checkedAt = result.stale
    ? formatKstDateTime(result.fetchedAt ? new Date(result.fetchedAt) : undefined)
    : formatKstClock(result.fetchedAt);

  return (
    <div className="flex flex-col gap-4">
      {result.stale && <StaleBanner />}

      <section className={card}>
        <h1 className={`text-3xl font-extrabold tracking-tight ${data.delivered ? "text-accent-text" : ""}`}>
          {statusLabel(data)}
        </h1>
        {latest && (
          <p className="mt-1.5 text-sm text-muted">
            <span className="tabular-nums">{shortDateTime(latest.time)}</span>
            {latest.location && <> · {latest.location}</>}
          </p>
        )}
        <div className="mt-5">
          <StepBar steps={data.steps} />
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-3 text-sm font-bold">이동 내역</h2>
        <EventTable events={data.events} />
      </section>

      <section className={card}>
        {hasRecipient && (
          // 모달과 같은 구성: 첫 줄 이름(굵게), 둘째 줄 지역. 지역이 비면 둘째 줄을 숨긴다
          <div className="mb-3 border-b border-line pb-3 text-sm">
            {recipientName && <p className="font-bold">{recipientName} 님</p>}
            {recipient?.address && <p className="mt-0.5 text-muted">{recipient.address}</p>}
          </div>
        )}
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {courier?.name && <CourierRow label="택배사">{courier.name}</CourierRow>}
            {courier?.phone && <CourierRow label="전화번호">{courier.phone}</CourierRow>}
            <CourierRow label="송장번호">{invoiceNo}</CourierRow>
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted">
          마지막 확인 <span className="tabular-nums">{checkedAt}</span>
        </p>
        <RefreshLink href={`/${data.invoiceNo}?refresh=1`}>새로고침</RefreshLink>
      </div>
    </div>
  );
}

function NotFoundView({ result }: { result: TrackingResult }) {
  const info = result.notFound;
  const checkedAt = result.stale
    ? formatKstDateTime(result.fetchedAt ? new Date(result.fetchedAt) : undefined)
    : formatKstClock(result.fetchedAt);
  return (
    <div className="flex flex-col gap-4">
      {result.stale && <StaleBanner />}
      <section className={`${card} text-center`}>
        <div
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-text"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
            <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-bold">{info?.title ?? "검색결과가 없습니다."}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {info?.message ?? "운송장 미등록 상태이거나 업체에서 상품을 준비중입니다."}
        </p>
        <p className="mt-4 rounded-lg bg-background px-3 py-2.5 text-sm leading-relaxed">
          상품 출고 직후에는 조회되기까지 시간이 걸릴 수 있어요.
          <br />
          잠시 후 다시 확인해 주세요.
        </p>
        <p className="mt-4 text-xs text-muted">
          운송장번호 <span className="tabular-nums">{result.invoiceNo}</span>
        </p>
      </section>
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted">
          마지막 확인 <span className="tabular-nums">{checkedAt}</span>
        </p>
        <RefreshLink href={`/${result.invoiceNo}?refresh=1`}>다시 조회</RefreshLink>
      </div>
    </div>
  );
}

function UnavailableView({ result, fallbackLink }: { result: TrackingResult; fallbackLink: string | null }) {
  return (
    <section className={`${card} text-center`}>
      <div
        aria-hidden="true"
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warn-bg text-warn-fg"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
          <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
          <path
            d="M10.3 4.2L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-bold">일시적으로 조회할 수 없습니다</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">잠시 후 다시 시도해 주세요.</p>
      <p className="mt-4 text-xs text-muted">
        운송장번호 <span className="tabular-nums">{result.invoiceNo}</span>
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <RefreshLink href={`/${result.invoiceNo}`}>새로고침</RefreshLink>
        {fallbackLink && (
          // 조회 API 를 쓸 수 없을 때의 보조 수단: 외부 배송조회 페이지로 연결한다
          <a
            href={fallbackLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-bold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            배송조회 페이지에서 보기
          </a>
        )}
      </div>
    </section>
  );
}

function InvalidView({ result }: { result: TrackingResult }) {
  return (
    <section className={card}>
      <h1 className="text-xl font-bold">올바른 운송장번호가 아닙니다</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        운송장번호는 숫자 10~16자리입니다. 번호를 다시 확인해 주세요.
      </p>
      <div className="mt-5">
        <InvoiceForm initial={result.invoiceNo} />
      </div>
    </section>
  );
}

export default function TrackingView({
  result,
  fallbackLink = null,
}: {
  result: TrackingResult;
  /** 조회 불가일 때 보조로 보여줄 외부 배송조회 페이지 주소 (없으면 버튼 숨김) */
  fallbackLink?: string | null;
}) {
  switch (result.status) {
    case "ok":
      return result.data ? (
        <OkView result={result} data={result.data} />
      ) : (
        <UnavailableView result={result} fallbackLink={fallbackLink} />
      );
    case "not_found":
      return <NotFoundView result={result} />;
    case "unavailable":
      return <UnavailableView result={result} fallbackLink={fallbackLink} />;
    case "invalid":
      return <InvalidView result={result} />;
  }
}

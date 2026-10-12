import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import CopyButton from "@/components/CopyButton";
import Shell from "@/components/Shell";
import { checkAdminAuth } from "@/lib/auth";
import { formatKstDateTime, shortDateTime } from "@/lib/format";
import { getStore } from "@/lib/store";
import type { InvoiceDoc } from "@/lib/store/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "관리자 · 등록 운송장",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function snapshotSummary(doc: InvoiceDoc): { main: string; sub: string } {
  if (doc.snapshotKind === "ok" && doc.snapshot) {
    const { currentStep, latest } = doc.snapshot;
    // 현재 단계와 최신 이벤트 상태가 같으면(예: 배송완료) 한 번만 보여준다
    const main = [...new Set([currentStep, latest?.status].filter(Boolean))].join(" · ") || "배송 이력 없음";
    const sub = latest ? [shortDateTime(latest.time), latest.location].filter(Boolean).join(" ") : "";
    return { main: doc.delivered && !main.includes("배송완료") ? `${main} (완료)` : main, sub };
  }
  if (doc.snapshotKind === "not_found") return { main: "검색결과 없음", sub: "" };
  return { main: "미조회", sub: "" };
}

function pageHref(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // middleware 가 이미 막지만, 매처 설정 실수에 대비해 한 번 더 확인 (방어적 이중 체크)
  if (checkAdminAuth((await headers()).get("authorization")) !== "ok") notFound();

  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 100);
  const requestedPage = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // 목록은 저장된 스냅샷만 보여준다. 여기서 배송 조회 API 를 호출하지 않는다.
  const { items, total } = await getStore().listRegistered({ q, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Shell wide banner={false}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">등록된 운송장</h1>
            <p className="mt-1 text-sm text-muted">
              총 <span className="tabular-nums">{total.toLocaleString("ko-KR")}</span>건 · 저장된 스냅샷만 표시합니다
              (이 화면에서 배송 조회를 하지 않아요)
            </p>
          </div>
          <form action="/admin" method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="운송장번호 / 상품명 / 주문번호"
              className="h-10 w-64 rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-accent"
              aria-label="검색어"
            />
            <button type="submit" className="h-10 rounded-lg bg-accent px-4 text-sm font-bold text-accent-fg">
              검색
            </button>
          </form>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">운송장번호</th>
                <th className="px-3 py-3 font-medium">operator</th>
                <th className="px-3 py-3 font-medium">상품명</th>
                <th className="px-3 py-3 font-medium">수령인</th>
                <th className="px-3 py-3 font-medium">등록시각</th>
                <th className="px-3 py-3 font-medium">마지막 상태</th>
                <th className="px-3 py-3 font-medium">확인시각</th>
                <th className="px-3 py-3 font-medium">고객 링크</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    {q ? "검색 결과가 없습니다." : "등록된 운송장이 없습니다."}
                  </td>
                </tr>
              )}
              {items.map((doc) => {
                const summary = snapshotSummary(doc);
                return (
                  <tr key={doc._id} className="align-top">
                    <td className="px-4 py-3 tabular-nums">
                      <a
                        href={`/${doc._id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-accent underline underline-offset-2"
                      >
                        {doc._id}
                      </a>
                      {doc.meta?.orderId && (
                        <p className="mt-0.5 text-xs text-muted">주문 {doc.meta.orderId}</p>
                      )}
                    </td>
                    <td className="px-3 py-3">{doc.operator ?? "-"}</td>
                    <td className="max-w-64 px-3 py-3">{doc.meta?.productName ?? "-"}</td>
                    <td className="px-3 py-3">{doc.meta?.receiverName ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {formatKstDateTime(doc.registeredAt) || "-"}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{summary.main}</p>
                      {summary.sub && <p className="mt-0.5 text-xs text-muted tabular-nums">{summary.sub}</p>}
                      {doc.lastError && (
                        <p className="mt-0.5 text-xs text-danger" title={doc.lastError}>
                          최근 오류: {doc.lastError.slice(0, 40)}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted tabular-nums">
                      {formatKstDateTime(doc.snapshotAt) || "-"}
                    </td>
                    <td className="px-3 py-3">
                      <CopyButton path={`/${doc._id}`} label="링크 복사" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <nav className="flex items-center justify-between text-sm" aria-label="페이지">
          {page > 1 ? (
            <a href={pageHref(q, page - 1)} className="rounded-lg border border-line px-3 py-2 hover:bg-accent-soft">
              이전
            </a>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-muted">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <a href={pageHref(q, page + 1)} className="rounded-lg border border-line px-3 py-2 hover:bg-accent-soft">
              다음
            </a>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </Shell>
  );
}

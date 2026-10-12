// 개발/테스트용 인메모리 저장소 (MONGODB_URI 미설정 시 사용). 재시작하면 데이터가 사라진다.
import type {
  InvoiceDoc,
  InvoiceMeta,
  InvoiceStore,
  ListQuery,
  ListResult,
  RegistrationInput,
  SnapshotInput,
  UpsertResult,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function definedMeta(meta: InvoiceMeta): InvoiceMeta {
  const out: InvoiceMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) (out as Record<string, string>)[key] = value;
  }
  return out;
}

function newDoc(invoiceNo: string, now: Date): InvoiceDoc {
  return {
    _id: invoiceNo,
    registered: false,
    createdAt: now,
    updatedAt: now,
    snapshot: null,
    snapshotKind: null,
    snapshotAt: null,
    delivered: false,
  };
}

export class MemoryInvoiceStore implements InvoiceStore {
  private readonly docs = new Map<string, InvoiceDoc>();

  async get(invoiceNo: string): Promise<InvoiceDoc | null> {
    const doc = this.docs.get(invoiceNo);
    return doc ? clone(doc) : null;
  }

  async upsertRegistrations(
    items: RegistrationInput[],
    operator: string,
    now: Date,
  ): Promise<UpsertResult> {
    let upserted = 0;
    let updated = 0;
    for (const item of items) {
      const meta = definedMeta(item.meta);
      const existing = this.docs.get(item.invoiceNo);
      if (existing?.registered) {
        // 이미 등록된 건: meta 만 병합 갱신, registeredAt/operator 유지
        existing.meta = { ...existing.meta, ...meta };
        existing.updatedAt = now;
        updated++;
        continue;
      }
      const doc = existing ?? newDoc(item.invoiceNo, now);
      doc.registered = true;
      doc.operator = operator;
      doc.registeredAt = now;
      doc.meta = { ...doc.meta, ...meta };
      doc.updatedAt = now;
      this.docs.set(item.invoiceNo, doc);
      upserted++;
    }
    return { upserted, updated };
  }

  async saveSnapshot(invoiceNo: string, input: SnapshotInput, now: Date): Promise<void> {
    const doc = this.docs.get(invoiceNo) ?? newDoc(invoiceNo, now);
    if (input.kind === "ok") {
      doc.snapshot = clone(input.data);
      doc.snapshotKind = "ok";
      doc.delivered = input.data.delivered;
      delete doc.notFound;
    } else {
      doc.snapshot = null;
      doc.snapshotKind = "not_found";
      doc.delivered = false;
      doc.notFound = { title: input.title, message: input.message };
    }
    doc.snapshotAt = now;
    doc.lastAttemptAt = now;
    delete doc.lastError;
    doc.updatedAt = now;
    this.docs.set(invoiceNo, doc);
  }

  async saveAttemptError(invoiceNo: string, error: string, now: Date): Promise<void> {
    const doc = this.docs.get(invoiceNo) ?? newDoc(invoiceNo, now);
    doc.lastAttemptAt = now;
    doc.lastError = error.slice(0, 300);
    doc.updatedAt = now;
    this.docs.set(invoiceNo, doc);
  }

  async listRegistered(query: ListQuery): Promise<ListResult> {
    const needle = query.q?.trim().toLowerCase();
    let rows = [...this.docs.values()].filter((d) => d.registered);
    if (needle) {
      rows = rows.filter(
        (d) =>
          d._id.toLowerCase().includes(needle) ||
          (d.meta?.productName ?? "").toLowerCase().includes(needle) ||
          (d.meta?.orderId ?? "").toLowerCase().includes(needle),
      );
    }
    // 최신 등록순 (같은 시각이면 번호 내림차순으로 안정 정렬)
    rows.sort((a, b) => {
      const diff = (b.registeredAt?.getTime() ?? 0) - (a.registeredAt?.getTime() ?? 0);
      return diff !== 0 ? diff : b._id.localeCompare(a._id);
    });
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: rows.slice(start, start + query.pageSize).map(clone),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

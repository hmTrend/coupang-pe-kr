// MongoDB 저장소 (공식 mongodb 드라이버)
import { MongoClient, type AnyBulkWriteOperation, type Collection, type Filter } from "mongodb";
import type {
  InvoiceDoc,
  InvoiceStore,
  ListQuery,
  ListResult,
  RegistrationInput,
  SnapshotInput,
  UpsertResult,
} from "./types";

const COLLECTION = "invoices";

// 연결은 프로세스당 하나만 (Next dev 핫리로드에서 연결이 계속 늘어나지 않게 globalThis 에 보관)
const globalForMongo = globalThis as unknown as {
  __mongoClientPromise?: Promise<MongoClient>;
};

function getMongoClient(uri: string): Promise<MongoClient> {
  if (!globalForMongo.__mongoClientPromise) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    globalForMongo.__mongoClientPromise = client.connect().catch((error) => {
      // 실패한 프로미스를 캐시하지 않아야 다음 요청에서 재시도할 수 있다
      globalForMongo.__mongoClientPromise = undefined;
      throw error;
    });
  }
  return globalForMongo.__mongoClientPromise;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class MongoInvoiceStore implements InvoiceStore {
  private indexesReady?: Promise<void>;

  constructor(
    private readonly uri: string,
    private readonly dbName: string,
  ) {}

  private async collection(): Promise<Collection<InvoiceDoc>> {
    const client = await getMongoClient(this.uri);
    const col = client.db(this.dbName).collection<InvoiceDoc>(COLLECTION);
    if (!this.indexesReady) {
      this.indexesReady = col
        .createIndexes([
          { key: { registered: 1, registeredAt: -1 }, name: "registered_registeredAt" },
          { key: { delivered: 1 }, name: "delivered" },
        ])
        .then(() => undefined)
        .catch((error) => {
          this.indexesReady = undefined;
          throw error;
        });
    }
    await this.indexesReady;
    return col;
  }

  async get(invoiceNo: string): Promise<InvoiceDoc | null> {
    const col = await this.collection();
    return col.findOne({ _id: invoiceNo });
  }

  async upsertRegistrations(
    items: RegistrationInput[],
    operator: string,
    now: Date,
  ): Promise<UpsertResult> {
    if (items.length === 0) return { upserted: 0, updated: 0 };
    const col = await this.collection();

    // 이미 등록된 번호를 먼저 조회해서 "신규 등록"과 "meta 갱신"을 구분한다
    const existing = await col
      .find(
        { _id: { $in: items.map((i) => i.invoiceNo) } },
        { projection: { registered: 1 } },
      )
      .toArray();
    const alreadyRegistered = new Set(existing.filter((d) => d.registered).map((d) => d._id));

    let upserted = 0;
    let updated = 0;
    const ops: AnyBulkWriteOperation<InvoiceDoc>[] = [];

    for (const item of items) {
      // 값이 있는 필드만 dotted-path 로 설정 → 기존 meta 의 다른 필드를 지우지 않는다
      const metaSet: Record<string, string> = {};
      for (const [key, value] of Object.entries(item.meta)) {
        if (value !== undefined) metaSet[`meta.${key}`] = value;
      }

      if (alreadyRegistered.has(item.invoiceNo)) {
        // registeredAt / operator 는 유지하고 meta 만 갱신
        updated++;
        ops.push({
          updateOne: {
            filter: { _id: item.invoiceNo },
            update: { $set: { ...metaSet, updatedAt: now } },
          },
        });
      } else {
        upserted++;
        ops.push({
          updateOne: {
            filter: { _id: item.invoiceNo },
            update: {
              $set: {
                ...metaSet,
                registered: true,
                operator,
                registeredAt: now,
                updatedAt: now,
              },
              $setOnInsert: {
                createdAt: now,
                snapshot: null,
                snapshotKind: null,
                snapshotAt: null,
                delivered: false,
              },
            },
            upsert: true,
          },
        });
      }
    }

    await col.bulkWrite(ops, { ordered: false });
    return { upserted, updated };
  }

  async saveSnapshot(invoiceNo: string, input: SnapshotInput, now: Date): Promise<void> {
    const col = await this.collection();
    const set: Record<string, unknown> = {
      snapshotAt: now,
      lastAttemptAt: now,
      updatedAt: now,
    };
    const unset: Record<string, ""> = { lastError: "" };

    if (input.kind === "ok") {
      set.snapshot = input.data;
      set.snapshotKind = "ok";
      set.delivered = input.data.delivered;
      unset.notFound = "";
    } else {
      set.snapshot = null;
      set.snapshotKind = "not_found";
      set.delivered = false;
      set.notFound = { title: input.title, message: input.message };
    }

    await col.updateOne(
      { _id: invoiceNo },
      {
        $set: set,
        $unset: unset,
        // 조회만 된 번호는 registered:false 로 캐시 문서를 만든다
        $setOnInsert: { registered: false, createdAt: now },
      },
      { upsert: true },
    );
  }

  async saveAttemptError(invoiceNo: string, error: string, now: Date): Promise<void> {
    const col = await this.collection();
    await col.updateOne(
      { _id: invoiceNo },
      {
        $set: { lastAttemptAt: now, lastError: error.slice(0, 300), updatedAt: now },
        $setOnInsert: {
          registered: false,
          createdAt: now,
          snapshot: null,
          snapshotKind: null,
          snapshotAt: null,
          delivered: false,
        },
      },
      { upsert: true },
    );
  }

  async listRegistered(query: ListQuery): Promise<ListResult> {
    const col = await this.collection();
    const filter: Filter<InvoiceDoc> = { registered: true };
    const q = query.q?.trim();
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ _id: re }, { "meta.productName": re }, { "meta.orderId": re }];
    }
    const [items, total] = await Promise.all([
      col
        .find(filter)
        .sort({ registeredAt: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .toArray(),
      col.countDocuments(filter),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}

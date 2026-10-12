// 저장소 선택: MONGODB_URI 가 있으면 Mongo, 없으면 인메모리(개발용)
import { mongoConfig } from "@/lib/config";
import { MemoryInvoiceStore } from "./memory";
import { MongoInvoiceStore } from "./mongo";
import type { InvoiceStore } from "./types";

export type { InvoiceStore } from "./types";

const globalForStore = globalThis as unknown as { __invoiceStore?: InvoiceStore };

export function getStore(): InvoiceStore {
  if (!globalForStore.__invoiceStore) {
    const { uri, db } = mongoConfig();
    if (uri) {
      globalForStore.__invoiceStore = new MongoInvoiceStore(uri, db);
    } else {
      console.warn(
        "[store] MONGODB_URI 가 설정되지 않아 인메모리 저장소를 사용합니다. (개발용: 재시작하면 등록/스냅샷이 모두 사라집니다)",
      );
      globalForStore.__invoiceStore = new MemoryInvoiceStore();
    }
  }
  return globalForStore.__invoiceStore;
}

/** 테스트용: 싱글톤 저장소를 교체/초기화한다 */
export function __setStoreForTest(store: InvoiceStore | undefined): void {
  globalForStore.__invoiceStore = store;
}

/**
 * What the phone keeps, in IndexedDB on this device only: the seller key, the issuedAt of each
 * offer it has published, and its last jobs. Nothing here is ever sent anywhere; the key leaves
 * this module only as a signer (runner/signer.ts).
 *
 * The key is a testnet key. Browser storage is readable by anything running on this origin and by
 * anyone holding the unlocked phone, so it must never hold real money.
 */

import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

const DB_NAME = "countersign-phone";
const STORE = "kv";
const SELLER = "seller-key";

let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("This browser would not open its storage."));
    request.onblocked = () => reject(new Error("Close this page's other tabs, then reload."));
  });
  return opened;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const store = (await db()).transaction(STORE, "readonly").objectStore(STORE);
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const tx = (await db()).transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(value, key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The write was abandoned."));
  });
}

export interface SellerRecord {
  key: Hex;
  /** Unix seconds when this device made the key. */
  madeAt: number;
}

/**
 * The seller key, made on first open. Read and create run in one readwrite transaction, so two
 * tabs opening at once still end with one key.
 */
export async function sellerKey(): Promise<SellerRecord> {
  const tx = (await db()).transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  return new Promise((resolve, reject) => {
    let record: SellerRecord | undefined;
    const read = store.get(SELLER);
    read.onsuccess = () => {
      const found = read.result as SellerRecord | undefined;
      if (found && typeof found.key === "string" && /^0x[0-9a-fA-F]{64}$/.test(found.key)) {
        record = found;
        return;
      }
      record = { key: generatePrivateKey(), madeAt: Math.floor(Date.now() / 1000) };
      store.put(record, SELLER);
    };
    tx.oncomplete = () => (record ? resolve(record) : reject(new Error("No seller key was stored.")));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The browser refused to store the key."));
  });
}

/** One issuedAt per seller and offer terms, so a reload republishes the same offer hash. */
export async function stableIssuedAt(termsKey: Hex, now: number): Promise<number> {
  const key = `issued:${termsKey}`;
  const stored = await kvGet<number>(key);
  if (typeof stored === "number" && Number.isSafeInteger(stored) && stored > 0) return stored;
  await kvSet(key, now);
  return now;
}

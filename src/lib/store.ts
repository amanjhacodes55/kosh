import { getStore } from "@netlify/blobs";

// Storage. Each bank's books are one JSON document, and every change to them is a compare-and-swap:
// read the document with its version (ETag), apply the operation, and write it back only if nobody
// else wrote in between; otherwise read again and retry. So two tellers posting at the same moment
// can never overwrite each other's work, and a failed operation leaves nothing half-done.
//
// On Netlify this is Netlify Blobs (strongly consistent, with conditional writes). Anywhere else it
// is an in-memory map, right for `next start`, tests and the demo video.

export interface Versioned<T> {
  value: T;
  etag: string;
}

export interface KV {
  get<T>(key: string): Promise<Versioned<T> | null>;
  /** Writes when the stored version is still `ifMatch` (or, with ifMatch null, when the key is new). */
  put(key: string, value: unknown, ifMatch?: string | null): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export function memoryStore(): KV {
  const data = new Map<string, { json: string; etag: string }>();
  let version = 0;
  return {
    async get<T>(key: string) {
      const v = data.get(key);
      return v ? { value: JSON.parse(v.json) as T, etag: v.etag } : null;
    },
    async put(key, value, ifMatch) {
      const cur = data.get(key);
      if (ifMatch === null && cur) return false;
      if (typeof ifMatch === "string" && cur?.etag !== ifMatch) return false;
      data.set(key, { json: JSON.stringify(value), etag: String(++version) });
      return true;
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

function blobStore(): KV {
  const store = getStore({ name: "kosh", consistency: "strong" });
  return {
    async get<T>(key: string) {
      // A missing key answers 403 and the client retries it for ~30 s; check that it exists first
      const { blobs } = await store.list({ prefix: key });
      if (!blobs.some((b) => b.key === key)) return null;
      const r = await store.getWithMetadata(key, { type: "json" });
      return r ? { value: r.data as T, etag: r.etag ?? "" } : null;
    },
    async put(key, value, ifMatch) {
      if (ifMatch === null) return (await store.setJSON(key, value, { onlyIfNew: true })).modified;
      if (typeof ifMatch === "string") return (await store.setJSON(key, value, { onlyIfMatch: ifMatch })).modified;
      await store.setJSON(key, value);
      return true;
    },
    async delete(key) {
      await store.delete(key);
    },
  };
}

declare global {
  var __koshStore: KV | undefined;
  var netlifyBlobsContext: unknown;
}

/** The store for this process: Blobs when Netlify provides a context, memory otherwise */
export function kv(): KV {
  if (globalThis.__koshStore) return globalThis.__koshStore;
  const onNetlify = Boolean(process.env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
  if (onNetlify) return blobStore();
  if (process.env.NETLIFY) throw new Error("Netlify Blobs is not available in this function.");
  return (globalThis.__koshStore = memoryStore());
}

export function setStoreForTests(store: KV) {
  globalThis.__koshStore = store;
}

/**
 * Applies `fn` to a document atomically. `fn` works on a fresh copy each attempt and may throw to
 * abandon the change; whatever it returns is passed back once the write has landed.
 */
export async function transact<T, R>(key: string, fn: (doc: T) => R, attempts = 8): Promise<{ doc: T; result: R }> {
  for (let i = 0; i < attempts; i++) {
    const cur = await kv().get<T>(key);
    if (!cur) throw Object.assign(new Error("not found"), { notFound: true });
    const doc = cur.value;
    const result = fn(doc);
    if (await kv().put(key, doc, cur.etag)) return { doc, result };
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (i + 1)));
  }
  throw new Error("The books are busy; try again.");
}

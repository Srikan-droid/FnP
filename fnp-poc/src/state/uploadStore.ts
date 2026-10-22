import type { ZipEntry } from "../domain/zipReader";

/**
 * Files the filer uploaded, held as real bytes. Drafts are JSON in localStorage and cannot
 * carry a blob, so uploads live in IndexedDB keyed by assessment and referenced from the draft
 * by id. That is also what lets the reviewer open the same document the applicant attached.
 */

const DB_NAME = "fnp-uploads";
const DB_VERSION = 1;
const STORE = "files";

export interface UploadedFile {
  id: string;
  assessmentId: string;
  name: string;
  extension: string;
  mimeType: string;
  size: number;
  addedAt: number;
  bytes: ArrayBuffer;
}

/** Everything except the bytes — what the UI needs to list and drag a file. */
export type UploadedFileMeta = Omit<UploadedFile, "bytes">;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export function mimeFor(extension: string): string {
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("assessmentId", "assessmentId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      })
  );
}

function newId(): string {
  return crypto.randomUUID?.() ?? `up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Stores every extracted entry and returns their metadata, newest batch last. */
export async function storeZipEntries(
  assessmentId: string,
  entries: ZipEntry[]
): Promise<UploadedFileMeta[]> {
  const db = await openDb();
  const added: UploadedFileMeta[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const entry of entries) {
      const record: UploadedFile = {
        id: newId(),
        assessmentId,
        name: entry.name,
        extension: entry.extension,
        mimeType: mimeFor(entry.extension),
        size: entry.size,
        addedAt: Date.now(),
        // A fresh copy: the subarray from the zip reader is a view over a larger buffer, and
        // structured clone would otherwise persist the whole archive for every entry.
        bytes: entry.bytes.slice().buffer,
      };
      store.put(record);
      const { bytes: _bytes, ...meta } = record;
      void _bytes;
      added.push(meta);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });

  return added;
}

export async function listUploads(assessmentId: string): Promise<UploadedFileMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("assessmentId");
    const request = index.getAll(assessmentId);
    request.onsuccess = () => {
      const files = (request.result as UploadedFile[]).map(({ bytes: _bytes, ...meta }) => {
        void _bytes;
        return meta;
      });
      files.sort((a, b) => a.addedAt - b.addedAt || a.name.localeCompare(b.name));
      resolve(files);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getUploadBlob(id: string): Promise<Blob | null> {
  const record = await run<UploadedFile | undefined>("readonly", (store) => store.get(id));
  if (!record) return null;
  return new Blob([record.bytes], { type: record.mimeType });
}

export async function deleteUpload(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

/** Clears an assessment's uploads — used when the filer starts the form again. */
export async function clearUploads(assessmentId: string): Promise<void> {
  const files = await listUploads(assessmentId);
  await Promise.all(files.map((f) => deleteUpload(f.id)));
}

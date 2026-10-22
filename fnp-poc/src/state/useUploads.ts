import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearUploads,
  deleteUpload,
  getUploadBlob,
  listUploads,
  storeZipEntries,
} from "./uploadStore";
import { readZip } from "../domain/zipReader";
import type { UploadedFileMeta } from "./uploadStore";

export interface AddResult {
  added: number;
  skipped: { path: string; reason: string }[];
  /** What the files came from, for the status line. */
  source: string;
}

export interface UploadsState {
  files: UploadedFileMeta[];
  /** Blob URL for an uploaded file, or null while it is still loading. */
  urlFor: (uploadId: string) => string | null;
  byId: (uploadId: string) => UploadedFileMeta | undefined;
  addZip: (file: File) => Promise<AddResult>;
  remove: (uploadId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Loads an assessment's uploads and keeps a blob URL for each one, so a link can be rendered
 * synchronously. URLs are revoked when the component unmounts or a file is removed; holding
 * them open for the life of the page is what avoids a flash of missing link on every render.
 */
export function useUploads(assessmentId: string): UploadsState {
  const [files, setFiles] = useState<UploadedFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Map<string, string>());

  const revokeAll = useCallback(() => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const listed = await listUploads(assessmentId);
      // Mint a URL per file before the first paint that needs it.
      await Promise.all(
        listed.map(async (file) => {
          if (urls.current.has(file.id)) return;
          const blob = await getUploadBlob(file.id);
          if (blob) urls.current.set(file.id, URL.createObjectURL(blob));
        })
      );
      setFiles(listed);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read stored uploads.");
    } finally {
      setLoading(false);
    }
  }, [assessmentId]);

  useEffect(() => {
    void load();
    return revokeAll;
  }, [load, revokeAll]);

  const addZip = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const { entries, skipped } = await readZip(file);
        if (entries.length > 0) await storeZipEntries(assessmentId, entries);
        await load();
        return { added: entries.length, skipped, source: file.name };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not read that archive.";
        setError(message);
        throw e;
      }
    },
    [assessmentId, load]
  );

  const remove = useCallback(
    async (uploadId: string) => {
      const url = urls.current.get(uploadId);
      if (url) {
        URL.revokeObjectURL(url);
        urls.current.delete(uploadId);
      }
      await deleteUpload(uploadId);
      await load();
    },
    [load]
  );

  const clearAll = useCallback(async () => {
    revokeAll();
    await clearUploads(assessmentId);
    await load();
  }, [assessmentId, load, revokeAll]);

  const urlFor = useCallback((uploadId: string) => urls.current.get(uploadId) ?? null, []);
  const byId = useCallback(
    (uploadId: string) => files.find((f) => f.id === uploadId),
    [files]
  );

  return { files, urlFor, byId, addZip, remove, clearAll, loading, error };
}

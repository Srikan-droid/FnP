import { useRef, useState } from "react";
import { ApiError } from "../api/client";
import { acceptAttribute, fileProblem, formatHint, sizeHint } from "../domain/catalogue";
import { CheckCircleIcon, FileTextIcon, InfoIcon, UploadIcon, XIcon } from "./icons";
import { DOCUMENT_DRAG } from "../domain/attachSource";
import { leftFor, useDocumentDrag, useDragOver } from "../state/documentDrag";
import type { LibraryDocument } from "../api/types";
import { formatBytes } from "../utils/format";

/** How many files are sent at once: enough to be quick, few enough not to trip the upload limit. */
const AT_ONCE = 3;

interface Queued {
  key: string;
  file: File;
  /** 0 to 1 while sending. */
  progress: number;
  status: "waiting" | "sending" | "failed";
  message?: string;
  /** Refused here for its format or size: sending it again would be refused again. */
  refused?: boolean;
  /** The same contents as a document already in "Your documents": it takes no room. */
  known?: boolean;
}

/** A file's SHA-256, as the server fingerprints documents; null where the browser cannot tell. */
async function fingerprint(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}


/** Why a file was not uploaded, in words the applicant can act on. */
function uploadProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many uploads at once. Retry in a moment.";
    if (error.status === 409) return error.message;
    return error.field("file") ?? error.message;
  }
  return "Not uploaded. Check your connection and retry.";
}

/**
 * "Your documents": the applicant uploads everything first (several files at once, by choosing or
 * dropping them), then drags each onto its question. The documents the answers ask for are listed
 * above the upload area. Each document says where it is attached; one attached nowhere is not sent
 * with the application.
 */
export default function DocumentLibrary({
  documents,
  max,
  fileTypes,
  maxBytes,
  qidLabel,
  onUpload,
  onRemove,
  onDrained,
}: {
  documents: LibraryDocument[];
  /** The most documents the library holds. */
  max: number;
  /** Every format a question or the CV accepts. */
  fileTypes: string[];
  maxBytes: number;
  /** "A1" -> how the question is named in a chip ("CV" stays "CV"). */
  qidLabel: (qid: string) => string;
  onUpload: (file: File, onProgress: (share: number) => void) => Promise<LibraryDocument>;
  onRemove: (documentId: string) => Promise<unknown>;
  /** Every file of a batch has gone up (or failed). */
  onDrained?: () => void;
}) {
  const chooser = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  // The queue as it is now: two drops before the page is drawn again each see the other's files.
  const queueNow = useRef<Queued[]>([]);
  const changeQueue = (change: (items: Queued[]) => Queued[]) => {
    queueNow.current = change(queueNow.current);
    setQueue(queueNow.current);
  };
  // Files held over the drop zone, for this drag only (cleared wherever the drag ends).
  const [dragging, setDragging] = useDragOver();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const drag = useDocumentDrag();
  // The queue as the running uploads see it (state updates arrive later than they read it).
  const running = useRef(0);
  const nextKey = useRef(0);
  const pending = useRef<Queued[]>([]);

  const update = (key: string, change: Partial<Queued>) =>
    changeQueue((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const sendNext = () => {
    while (running.current < AT_ONCE && pending.current.length > 0) {
      const item = pending.current.shift()!;
      running.current += 1;
      update(item.key, { status: "sending", progress: 0 });
      onUpload(item.file, (share) => update(item.key, { progress: share }))
        .then((document) => {
          changeQueue((items) => items.filter((i) => i.key !== item.key));
          if (document.duplicate) setNote(`"${item.file.name}" is already in your documents, as "${document.fileName}".`);
        })
        .catch((error: unknown) => update(item.key, { status: "failed", message: uploadProblem(error) }))
        .finally(() => {
          running.current -= 1;
          sendNext();
          // The whole batch is done: what the server now holds is read once.
          if (running.current === 0 && pending.current.length === 0) onDrained?.();
        });
    }
  };

  // Room for new documents: a queued file with the same contents as one already here takes none.
  const roomLeft = () =>
    max - documents.length - queueNow.current.filter((q) => q.status !== "failed" && !q.known).length;
  const newItem = (file: File, fields: Partial<Queued> = {}): Queued => {
    nextKey.current += 1;
    return { key: `upload-${nextKey.current}`, file, progress: 0, status: "waiting", ...fields };
  };
  const enqueue = (items: Queued[]) => {
    changeQueue((current) => [...current, ...items]);
    pending.current.push(...items.filter((i) => i.status === "waiting"));
    sendNext();
  };
  const fullNote = (count: number) =>
    setNote(`Your documents hold at most ${max} files: ${count} not added. Remove ones you no longer need first.`);

  const add = (files: File[]) => {
    setNote("");
    const room = roomLeft();
    const items: Queued[] = [];
    const over: File[] = [];
    for (const file of files) {
      // A file the server would refuse is refused here, before it is sent.
      const problem = fileProblem(file, fileTypes, maxBytes, "Upload");
      if (problem) items.push(newItem(file, { status: "failed", message: problem, refused: true }));
      else if (items.filter((i) => i.status === "waiting").length >= room) over.push(file);
      else items.push(newItem(file));
    }
    enqueue(items);
    if (over.length > 0) void addKnown(over);
  };

  // Files beyond the room left: only those already in "Your documents" (the same contents) are
  // sent, so the server finds the document there; the rest are not added.
  const addKnown = async (files: File[]) => {
    const here = new Set(documents.map((d) => d.sha256).filter(Boolean));
    const prints = await Promise.all(files.map(fingerprint));
    const items = files.filter((_, i) => prints[i] !== null && here.has(prints[i]!)).map((f) => newItem(f, { known: true }));
    if (files.length > items.length) fullNote(files.length - items.length);
    enqueue(items);
  };

  const retry = (item: Queued) => {
    // Sent again only if there is room for it: one the library has no room for would be refused.
    if (!item.known && roomLeft() <= 0) {
      update(item.key, {
        message: `Your documents hold at most ${max} files. Remove ones you no longer need, then retry.`,
      });
      return;
    }
    update(item.key, { status: "waiting", message: undefined, progress: 0 });
    pending.current.push({ ...item, status: "waiting" });
    sendNext();
  };

  const remove = async (doc: LibraryDocument) => {
    setBusy((b) => ({ ...b, [doc.id]: true }));
    setErrors((e) => ({ ...e, [doc.id]: "" }));
    try {
      await onRemove(doc.id);
      setConfirming(null);
    } catch (error) {
      setErrors((e) => ({
        ...e,
        [doc.id]:
          error instanceof ApiError && error.status === 409
            ? error.message
            : "Not removed. Check your connection and try again.",
      }));
    } finally {
      setBusy((b) => ({ ...b, [doc.id]: false }));
    }
  };

  const unattached = documents.filter((d) => d.usedBy.length === 0).length;

  return (
    <section className="card section doc-library" aria-labelledby="doc-library-title">
      <header className="doc-library-head">
        <div>
          <h2 id="doc-library-title">Your documents</h2>
          <p className="doc-library-sub">
            Upload all your documents here first, then drag each one onto its question. You can
            still upload a file at a question.
          </p>
        </div>
        {documents.length > 0 && (
          <span className="doc-library-count">
            {documents.length} uploaded{unattached > 0 ? ` · ${unattached} not attached yet` : ""}
          </span>
        )}
      </header>

      <div
        className={`doc-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (leftFor(e)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(Array.from(e.dataTransfer.files));
        }}
      >
        <UploadIcon size={20} />
        <p>
          <strong>Drop files here</strong> or{" "}
          <button type="button" className="link-button" onClick={() => chooser.current?.click()}>
            choose files
          </button>
        </p>
        <span className="doc-drop-hint">
          {formatHint(fileTypes)}, {sizeHint(maxBytes)} each. Choose several at once. Then drag each one
          onto its question.
        </span>
        <input
          ref={chooser}
          type="file"
          multiple
          hidden
          accept={acceptAttribute(fileTypes)}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ""; // choosing the same files again still adds them
            if (files.length > 0) add(files);
          }}
        />
      </div>

      {note && (
        <p className="doc-library-note" role="status">
          {note}
        </p>
      )}

      {queue.length > 0 && (
        <ul className="doc-queue" aria-label="Uploads">
          {queue.map((item) => (
            <li key={item.key} className={`doc-row is-${item.status}`}>
              <span className="doc-row-icon">
                <UploadIcon size={15} />
              </span>
              <span className="doc-row-main">
                <span className="doc-row-name">{item.file.name}</span>
                {item.status === "failed" ? (
                  <span className="field-error" role="alert">
                    {item.message}
                  </span>
                ) : (
                  <span
                    className="doc-progress"
                    role="progressbar"
                    aria-label={`Uploading ${item.file.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                  >
                    <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </span>
                )}
              </span>
              {item.status === "failed" ? (
                <span className="doc-row-actions">
                  {!item.refused && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => retry(item)}>
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-remove"
                    aria-label={`Dismiss ${item.file.name}`}
                    onClick={() => changeQueue((items) => items.filter((i) => i.key !== item.key))}
                  >
                    <XIcon size={14} />
                  </button>
                </span>
              ) : (
                <span className="doc-row-state">{item.status === "waiting" ? "Waiting…" : "Uploading…"}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {documents.length > 0 && (
        <ul className="doc-list" aria-label="Uploaded documents">
          {documents.map((doc) => {
            const used = doc.usedBy.length > 0;
            const asking = confirming === doc.id;
            return (
              <li
                key={doc.id}
                className={`doc-row${used ? " is-used" : ""}`}
                draggable
                title="Drag onto a question to attach it there"
                onDragStart={(e) => {
                  e.dataTransfer.setData(DOCUMENT_DRAG, doc.id);
                  e.dataTransfer.effectAllowed = "copy";
                  // Every question now shows whether it takes this document.
                  drag.setDoc(doc);
                }}
                onDragEnd={() => drag.setDoc(null)}
              >
                <span className="doc-row-grip" aria-hidden="true">
                  ⠿
                </span>
                <span className="doc-row-icon">
                  {used ? <CheckCircleIcon size={15} /> : <FileTextIcon size={15} />}
                </span>
                <span className="doc-row-main">
                  {/* Plain text: the row is dragged onto a question, and a link here would be
                      dragged (and opened) instead. The "i" beside it opens the document. */}
                  <span className="doc-row-name" title={doc.fileName}>
                    {doc.fileName}
                  </span>
                  <span className="doc-row-sub">
                    {doc.format.toUpperCase()} · {formatBytes(doc.sizeBytes)} ·{" "}
                    {used ? (
                      <span className="doc-used">
                        Used in{" "}
                        {[...new Set(doc.usedBy.map((u) => u.qid))].map((qid) => (
                          <span className="qid" key={qid}>
                            {qidLabel(qid)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="doc-unused">Not attached yet</span>
                    )}
                  </span>
                  {asking && (
                    <span className="doc-confirm" role="alert">
                      Used in {[...new Set(doc.usedBy.map((u) => qidLabel(u.qid)))].join(", ")}. Remove it from{" "}
                      {doc.usedBy.length > 1 ? "those questions" : "that question"} too?
                      <span className="doc-confirm-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                          Keep
                        </button>
                        <button
                          type="button"
                          className="btn btn-critical btn-sm"
                          disabled={busy[doc.id]}
                          onClick={() => void remove(doc)}
                        >
                          {busy[doc.id] ? "Removing…" : "Remove everywhere"}
                        </button>
                      </span>
                    </span>
                  )}
                  {errors[doc.id] && (
                    <span className="field-error" role="alert">
                      {errors[doc.id]}
                    </span>
                  )}
                </span>
                <span className="doc-row-actions">
                  {/* Never dragged itself: a drag started here moves the row, as anywhere on it. */}
                  <a
                    className="doc-row-open"
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    draggable={false}
                    aria-label={`Open ${doc.fileName}`}
                    title="Open the document"
                  >
                    <InfoIcon size={15} />
                  </a>
                  {!asking && (
                    <button
                      type="button"
                      className="btn-remove"
                      disabled={busy[doc.id]}
                      aria-label={`Remove ${doc.fileName}`}
                      title="Remove from your documents"
                      onClick={() => (used ? setConfirming(doc.id) : void remove(doc))}
                    >
                      <XIcon size={14} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

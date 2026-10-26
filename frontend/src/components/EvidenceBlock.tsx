import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  acceptAttribute,
  customName,
  DEFAULT_MAX_UPLOAD_BYTES,
  fileProblem,
  formatHint,
  OTHER_CODE,
  sameFormat,
  sizeHint,
} from "../domain/catalogue";
import { useMaxUploadBytes } from "../api/queries";
import { FileTextIcon, UploadIcon, XIcon } from "./icons";
import type { EvidenceOption } from "../domain/catalogue";
import type { EvidenceRef, EvidenceRole } from "../domain/types";
import type { LibraryDocument } from "../api/types";

import { DOCUMENT_DRAG, type AttachSource } from "../domain/attachSource";
import { leftFor, useDocumentDrag, useDragOver, type DocumentDrag } from "../state/documentDrag";
export type { AttachSource } from "../domain/attachSource";

export type AttachHandler = (
  optionCode: string,
  role: EvidenceRole,
  source: AttachSource,
  description?: string
) => Promise<unknown>;

/** The upload's error in words the filer can act on; the backend already words its own. */
function uploadMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many uploads at once. Wait a moment and try again.";
    for (const field of ["file", "documentId", "optionCode", "role", "qid", "description"]) {
      const message = error.field(field);
      if (message) return message;
    }
  }
  return "The document could not be uploaded. Try again.";
}

/** Why a document was not removed, in words the filer can act on. */
function removeMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "The document was not removed: the assessment has changed in the meantime. The page now shows where it stands.";
  }
  if (error instanceof ApiError && error.status === 404) return "This document had already been removed.";
  return "The document was not removed. Check your connection and try again.";
}

/** One attached document, with its role when the question distinguishes the two. */
function AttachedRow({
  file,
  label,
  showRole,
  onRemove,
}: {
  file: EvidenceRef;
  label: string;
  showRole: boolean;
  onRemove: () => Promise<unknown>;
}) {
  const isSupporting = file.role === "supporting";
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const errorId = `evidence-remove-error-${file.id}`;

  const remove = async () => {
    setRemoving(true);
    setError("");
    try {
      await onRemove();
    } catch (err) {
      setError(removeMessage(err));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="evidence">
      <span className="evidence-icon">
        <FileTextIcon size={17} />
      </span>
      <span className="evidence-meta">
        <span className="evidence-name">
          {file.fileName}
          {showRole && (
            <span className={`evidence-role${isSupporting ? " is-supporting" : ""}`}>
              {isSupporting ? "Supporting" : "Primary"}
            </span>
          )}
        </span>
        <span className="evidence-sub">{label} · attached</span>
        {error && (
          <span className="field-error" id={errorId} role="alert">
            {error}
          </span>
        )}
      </span>
      <button
        type="button"
        className="btn-remove"
        onClick={() => void remove()}
        disabled={removing}
        aria-describedby={error ? errorId : undefined}
        aria-label={`Remove ${file.fileName}`}
        title={
          isSupporting
            ? "Remove supporting document"
            : showRole
              ? "Remove the primary document and its supporting document"
              : "Remove attachment"
        }
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

/** What a drop carries: a document from "Your documents", a file from the computer, or why not. */
type Dropped = { doc: LibraryDocument } | { file: File } | { problem: string } | null;

/** Why a dragged document is not among those this question can take: on it already, or gone. */
function notOffered(id: string, attachedHere: string[]): string {
  return attachedHere.includes(id)
    ? "That document is already attached here."
    : 'That document is no longer in "Your documents".';
}

/**
 * Reads a drop: a document dragged from "Your documents" (it must be one this question can take,
 * in one of its formats), or a single file from the computer. `attachedHere`: the documents
 * already on this question, which `library` leaves out.
 */
function readDrop(
  e: React.DragEvent,
  library: LibraryDocument[],
  attachedHere: string[],
  accepted: string[],
  formats: string,
  maxBytes: number,
  fileTypes: string[]
): Dropped {
  const draggedId = e.dataTransfer.getData(DOCUMENT_DRAG);
  if (draggedId) {
    const doc = library.find((d) => d.id === draggedId);
    if (!doc) return { problem: notOffered(draggedId, attachedHere) };
    if (!accepted.includes(sameFormat(doc.format))) {
      return { problem: `This question accepts ${formats} files; "${doc.fileName}" is ${doc.format.toUpperCase()}.` };
    }
    return { doc };
  }
  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return null;
  if (files.length > 1) return { problem: 'Drop one file here. To add several at once, drop them in "Your documents".' };
  const problem = fileProblem(files[0], fileTypes, maxBytes);
  return problem ? { problem } : { file: files[0] };
}

/**
 * While a document is held over a question, its document types as drop targets: dropping on one
 * attaches the document as that type.
 */
function DropTypes({
  title,
  options,
  onDropType,
}: {
  title: string;
  options: EvidenceOption[];
  onDropType: (code: string, e: React.DragEvent) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="drop-types">
      <p className="drop-types-title">{title}</p>
      <ul>
        {options.map((o) => (
          <li
            key={o.code}
            className={`drop-type${over === o.code ? " is-over" : ""}`}
            onDragEnter={() => setOver(o.code)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (over !== o.code) setOver(o.code);
            }}
            onDragLeave={(e) => {
              if (leftFor(e)) setOver((c) => (c === o.code ? null : c));
            }}
            onDrop={(e) => {
              // Handled here: the box around it sees it is already taken (defaultPrevented). Not
              // stopped, so the page still hears that the drag is over.
              e.preventDefault();
              setOver(null);
              onDropType(o.code, e);
            }}
          >
            <span>{o.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whether what is being dragged across the page can be dropped on a question taking these formats. */
function dragFit(
  drag: DocumentDrag,
  library: LibraryDocument[],
  attachedHere: string[],
  accepted: string[],
  formats: string
) {
  if (drag.doc) {
    if (!library.some((d) => d.id === drag.doc!.id)) {
      return {
        active: true,
        ok: false,
        note: attachedHere.includes(drag.doc.id) ? "Already attached here" : 'No longer in "Your documents"',
      };
    }
    if (!accepted.includes(sameFormat(drag.doc.format))) return { active: true, ok: false, note: `Takes ${formats} only` };
    return { active: true, ok: true, note: "" };
  }
  return { active: drag.files, ok: drag.files, note: "" };
}

/** The document-type picker plus the attach button, used for both roles. */
function Picker({
  qid,
  role,
  options,
  defaultCode,
  fileTypes,
  library,
  attachedHere,
  onAttach,
}: {
  qid: string;
  role: EvidenceRole;
  options: EvidenceOption[];
  defaultCode: string;
  fileTypes: string[];
  /** "Your documents" not already on this question: the ones that can be dropped on it. */
  library: LibraryDocument[];
  /** The library documents already on this question. */
  attachedHere: string[];
  onAttach: AttachHandler;
}) {
  const isSupporting = role === "supporting";
  const drag = useDocumentDrag();
  const [optionCode, setOptionCode] = useState(() => (isSupporting ? "" : defaultCode));
  const [description, setDescription] = useState("");
  // A file dropped here before the document type was chosen: attached once it is.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // The same for a document dropped from "Your documents": its id.
  const [heldId, setHeldId] = useState("");
  const [dropOver, setDropOver] = useDragOver();
  const [hint, setHint] = useState("");
  // What is being sent: a new file, or a document from "Your documents".
  const [sending, setSending] = useState<"file" | "doc" | null>(null);
  const uploading = sending !== null;
  const [error, setError] = useState("");
  const chooser = useRef<HTMLInputElement>(null);
  const describe = useRef<HTMLInputElement>(null);
  // Already loaded by every page with a form; read here for the upload limit.
  // The page's assessment (every page with a form has it in its address).
  const { id = "" } = useParams();
  const maxBytes = useMaxUploadBytes(id) ?? DEFAULT_MAX_UPLOAD_BYTES;

  const isOther = optionCode === OTHER_CODE;
  const canAttach = optionCode !== "" && (!isOther || description.trim() !== "") && !uploading;
  const selectId = `evidence-type-${role}-${qid}`;
  const accepted = fileTypes.map(sameFormat);
  const formats = fileTypes.map((t) => t.toUpperCase()).join(", ");
  const describeId = `evidence-describe-${role}-${qid}`;
  const errorId = `evidence-error-${role}-${qid}`;
  const fit = dragFit(drag, library, attachedHere, accepted, formats);
  // The question's own types to drop on: "Other" needs words, so it asks for them after the drop.
  const several = options.length > 1;

  const send = async (source: AttachSource, code = optionCode, words = description) => {
    setSending(source instanceof File ? "file" : "doc");
    setError("");
    try {
      await onAttach(code, role, source, code === OTHER_CODE ? words.trim() : undefined);
      setOptionCode(isSupporting ? "" : defaultCode);
      setDescription("");
      setHeldId("");
      setPendingFile(null);
      setHint("");
    } catch (err) {
      setError(uploadMessage(err));
    } finally {
      setSending(null);
    }
  };

  const upload = async (file: File) => {
    // A file the server would refuse is refused here, before it is sent.
    const problem = fileProblem(file, fileTypes, maxBytes);
    if (problem) {
      setError(problem);
      return;
    }
    await send(file);
  };

  // Keeps what was dropped until the type (or, for "Other", its description) is given.
  const holdFor = (dropped: { doc: LibraryDocument } | { file: File }, message: string) => {
    if ("doc" in dropped) {
      setPendingFile(null);
      setHeldId(dropped.doc.id);
    } else {
      setHeldId("");
      setPendingFile(dropped.file);
    }
    setHint(message);
  };
  const nameOf = (dropped: { doc: LibraryDocument } | { file: File }) =>
    "doc" in dropped ? dropped.doc.fileName : dropped.file.name;
  const sourceOf = (dropped: { doc: LibraryDocument } | { file: File }): AttachSource =>
    "doc" in dropped ? { documentId: dropped.doc.id } : dropped.file;

  // Dropped on one of the types: attached as that type ("Other" first asks what it is).
  const dropOnType = (code: string, e: React.DragEvent) => {
    setDropOver(false);
    setError("");
    if (uploading) return;
    const dropped = readDrop(e, library, attachedHere, accepted, formats, maxBytes, fileTypes);
    if (!dropped) return;
    if ("problem" in dropped) {
      setError(dropped.problem);
      return;
    }
    if (code === OTHER_CODE) {
      setOptionCode(OTHER_CODE);
      holdFor(dropped, `Say what "${nameOf(dropped)}" is, then attach it.`);
      window.setTimeout(() => describe.current?.focus(), 0);
      return;
    }
    setOptionCode(code);
    void send(sourceOf(dropped), code);
  };

  const draggedName = drag.doc?.fileName;
  // What was dropped and waits for its type: attached by the main button once the type is chosen.
  // A held document removed meanwhile from "Your documents" is no longer held.
  const heldDoc = library.find((d) => d.id === heldId);
  const heldName = pendingFile?.name ?? heldDoc?.fileName;
  const letGo = () => {
    setPendingFile(null);
    setHeldId("");
    setHint("");
  };
  // Held over the box: its types open to drop on (with one type, the box itself is the target).
  const showTypes = dropOver && several && fit.ok !== false && !uploading;

  // Dropped on the box itself: attached at once when the type is known; otherwise it waits.
  const drop = (e: React.DragEvent) => {
    // Dropped on one of the types inside the box: that drop has been handled already.
    if (e.isDefaultPrevented()) return;
    e.preventDefault();
    // The types were open and it was let go beside them: no type was chosen, so nothing is attached.
    if (showTypes) {
      setDropOver(false);
      return;
    }
    setDropOver(false);
    setError("");
    setHint("");
    if (uploading) return;
    const dropped = readDrop(e, library, attachedHere, accepted, formats, maxBytes, fileTypes);
    if (!dropped) return;
    if ("problem" in dropped) {
      setError(dropped.problem);
      return;
    }
    if (canAttach) void send(sourceOf(dropped));
    else holdFor(dropped, `Choose the document type, then attach "${nameOf(dropped)}".`);
  };

  return (
    <div
      className={`evidence evidence-pending${isSupporting ? " is-supporting" : ""}${dropOver ? " is-drop-target" : ""}${
        fit.active ? (fit.ok ? " is-drop-ready" : " is-drop-blocked") : ""
      }`}
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        if (!types.includes(DOCUMENT_DRAG) && !types.includes("Files")) return;
        if (fit.active && !fit.ok) return; // refused: the browser shows it cannot be dropped
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dropOver) setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (leftFor(e)) setDropOver(false);
      }}
      onDrop={drop}
    >
      <span className="evidence-icon is-pending">
        <UploadIcon size={17} />
      </span>

      <div className="evidence-picker">
        {fit.active && !fit.ok && <span className="evidence-drop-blocked">{fit.note}</span>}
        {fit.active && fit.ok && !dropOver && (
          <span className="evidence-drop-ready">{several ? "Drop here to choose its type" : "Drop here to attach"}</span>
        )}
        {showTypes ? (
          <DropTypes
            title={`Drop ${draggedName ? `"${draggedName}"` : "the file"} on the right type`}
            options={options}
            onDropType={dropOnType}
          />
        ) : (
          <>
            <label className="field-label" htmlFor={selectId}>
              {isSupporting ? "Supporting document (optional)" : "Document type"}
            </label>
            <select
              id={selectId}
              className="input"
              value={optionCode}
              onChange={(e) => setOptionCode(e.target.value)}
              aria-describedby={error ? errorId : undefined}
            >
              <option value="" disabled>
                {isSupporting ? "Add a second document to cross-check…" : "Select the document you are attaching…"}
              </option>
              {options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>

            {isOther && (
              <input
                ref={describe}
                id={describeId}
                className="input"
                type="text"
                placeholder="Describe the document you are attaching"
                aria-label="Describe the document you are attaching"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}

            {heldName && (
              <span className="evidence-pending-file">
                Ready to attach: <strong>{heldName}</strong>
                <button
                  type="button"
                  className="btn-remove"
                  aria-label={`Don't attach ${heldName}`}
                  onClick={letGo}
                >
                  <XIcon size={12} />
                </button>
              </span>
            )}
            {hint && (
              <span className="evidence-drop-note" role="status">
                {hint}
              </span>
            )}

            {optionCode ? (
              <span className="evidence-formats">
                Accepts {formatHint(fileTypes)}, {sizeHint(maxBytes)} · or drop a file here
              </span>
            ) : (
              // Waiting for the type after a drop: the note above already says what to do.
              !hint && (
                <span className="evidence-formats">Choose the type, or drop a file or one of your documents here</span>
              )
            )}
          </>
        )}
        {error && (
          <p className="field-error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </div>

      <input
        ref={chooser}
        type="file"
        hidden
        accept={acceptAttribute(fileTypes)}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // choosing the same file again still triggers an upload
          if (file) void upload(file);
        }}
      />
      {!showTypes && (
        <button
          type="button"
          className={`btn btn-sm ${heldName ? "btn-primary" : "btn-ghost"}`}
          disabled={!canAttach}
          onClick={() =>
            pendingFile
              ? void upload(pendingFile)
              : heldDoc
                ? void send({ documentId: heldDoc.id })
                : chooser.current?.click()
          }
        >
          {sending === "file"
            ? "Uploading…"
            : sending === "doc"
              ? "Attaching…"
              : pendingFile
                ? "Attach dropped file"
                : heldDoc
                  ? "Attach dropped document"
                  : isSupporting
                    ? "Attach supporting"
                    : "Attach document"}
        </button>
      )}
    </div>
  );
}

/**
 * On a question that already has its document, shown while a document from "Your documents" is
 * dragged, or files from the computer are held over this question: dropping on one of its types
 * replaces the document (the old file stays in "Your documents"). Letting go anywhere else, the
 * box itself included, replaces nothing.
 */
function ReplaceTarget({
  current,
  withSupporting,
  options,
  fileTypes,
  library,
  attachedHere,
  filesHere,
  onAttach,
}: {
  current: EvidenceRef;
  withSupporting: boolean;
  options: EvidenceOption[];
  fileTypes: string[];
  library: LibraryDocument[];
  attachedHere: string[];
  /** Files from the computer are held over this question (not just somewhere on the page). */
  filesHere: boolean;
  onAttach: AttachHandler;
}) {
  const drag = useDocumentDrag();
  const [over, setOver] = useDragOver();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { id = "" } = useParams();
  const maxBytes = useMaxUploadBytes(id) ?? DEFAULT_MAX_UPLOAD_BYTES;
  const accepted = fileTypes.map(sameFormat);
  const formats = fileTypes.map((t) => t.toUpperCase()).join(", ");
  const fit = dragFit(drag, library, attachedHere, accepted, formats);
  // Files on their way to "Your documents" pass over the questions: only the one they are held over
  // offers to replace its document, so the rest of the form stays put.
  const shown = fit.active && (drag.doc !== null || filesHere);
  // "Other" needs words, which a drop cannot carry: a replacement is one of the named types.
  const types = options.filter((o) => o.code !== OTHER_CODE);
  if ((!shown && !busy && !error) || types.length === 0) return null;

  const replace = async (code: string, e: React.DragEvent) => {
    setOver(false);
    setError("");
    const dropped = readDrop(e, library, attachedHere, accepted, formats, maxBytes, fileTypes);
    if (!dropped) return;
    if ("problem" in dropped) {
      setError(dropped.problem);
      return;
    }
    setBusy(true);
    try {
      await onAttach(code, "primary", "doc" in dropped ? { documentId: dropped.doc.id } : dropped.file);
    } catch (err) {
      setError(uploadMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const label = `Replace "${current.fileName}"${withSupporting ? " and its supporting document" : ""}`;
  return (
    <div
      className={`evidence evidence-replace${over ? " is-drop-target" : ""}${fit.active ? (fit.ok ? " is-drop-ready" : " is-drop-blocked") : ""}`}
      onDragOver={(e) => {
        if (fit.active && !fit.ok) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (leftFor(e)) setOver(false);
      }}
      onDrop={(e) => {
        // Dropped on the box, not on a type: nothing is replaced without that deliberate choice.
        e.preventDefault();
        setOver(false);
      }}
    >
      <span className="evidence-icon is-pending">
        <UploadIcon size={17} />
      </span>
      <div className="evidence-picker">
        {busy ? (
          <span className="evidence-drop-note">Replacing…</span>
        ) : shown && !fit.ok ? (
          <span className="evidence-drop-blocked">{fit.note}</span>
        ) : shown && over ? (
          <DropTypes
            title={`${label}: drop on its type. The old one stays in "Your documents".`}
            options={types}
            onDropType={(code, e) => void replace(code, e)}
          />
        ) : shown ? (
          <span className="evidence-drop-ready">{label}: hold it here, then drop it on its type.</span>
        ) : null}
        {error && (
          <p className="field-error evidence-replace-error" role="alert">
            {error}
            <button
              type="button"
              className="btn-remove"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => setError("")}
            >
              <XIcon size={14} />
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export default function EvidenceBlock({
  qid,
  evidence,
  options,
  defaultCode,
  fileTypes,
  allowSupporting,
  labelFor,
  library = [],
  onAttach,
  onRemove,
}: {
  qid: string;
  evidence: EvidenceRef[];
  /** The document types this question accepts, from the catalogue. */
  options: EvidenceOption[];
  /** The type to pre-select when the question has only one. */
  defaultCode: string;
  /** Formats the question accepts. */
  fileTypes: string[];
  /** Whether a second, supporting document may be added. */
  allowSupporting: boolean;
  labelFor: (file: EvidenceRef) => string;
  /** "Your documents": the ones not on this question yet can be dropped on it. */
  library?: LibraryDocument[];
  onAttach: AttachHandler;
  /** Settles once the document is removed; rejects if it was not, and the row says why. */
  onRemove: (evidenceId: string) => Promise<unknown>;
}) {
  const primary = evidence.filter((e) => e.role !== "supporting");
  const supporting = evidence.filter((e) => e.role === "supporting");
  // A document already on this question is not offered for it again.
  const choices = library.filter((d) => !d.usedBy.some((u) => u.qid === qid));
  const attachedHere = library.filter((d) => d.usedBy.some((u) => u.qid === qid)).map((d) => d.id);
  const [filesHere, setFilesHere] = useDragOver();

  if (primary.length === 0) {
    return (
      <Picker
        qid={qid}
        role="primary"
        options={options}
        defaultCode={defaultCode}
        fileTypes={fileTypes}
        library={choices}
        attachedHere={attachedHere}
        onAttach={onAttach}
      />
    );
  }

  const remaining = allowSupporting
    ? options.filter((o) =>
        o.code === OTHER_CODE
          ? true
          : // Document types named here share the engine's "other" type: each is told apart by its code.
            customName(o.code) !== null
            ? !evidence.some((e) => e.option_code === o.code)
            : !evidence.some((e) => e.doc_type === o.docType)
      )
    : [];

  return (
    <div
      className="evidence-list"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setFilesHere(true);
      }}
      onDragLeave={(e) => {
        if (leftFor(e)) setFilesHere(false);
      }}
    >
      {[...primary, ...supporting].map((file) => (
        <AttachedRow
          key={file.id}
          file={file}
          label={labelFor(file)}
          showRole={allowSupporting}
          onRemove={() => onRemove(file.id)}
        />
      ))}

      {allowSupporting && supporting.length === 0 && remaining.length > 0 && (
        <Picker
          qid={qid}
          role="supporting"
          options={remaining}
          defaultCode=""
          fileTypes={fileTypes}
          library={choices}
          attachedHere={attachedHere}
          onAttach={onAttach}
        />
      )}

      <ReplaceTarget
        current={primary[0]}
        withSupporting={supporting.length > 0}
        options={options}
        fileTypes={fileTypes}
        library={choices}
        attachedHere={attachedHere}
        filesHere={filesHere}
        onAttach={onAttach}
      />
    </div>
  );
}

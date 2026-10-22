import { useState } from "react";
import {
  acceptsSupportingEvidence,
  defaultOptionCodeFor,
  evidenceFileName,
  evidenceOptionsFor,
  findOption,
  formatHint,
  optionForUpload,
  labelForDocType,
  OTHER_OPTION,
} from "../domain/evidenceOptions";
import { ExternalLinkIcon, FileTextIcon, UploadIcon, XIcon } from "./icons";
import type { EvidenceOption } from "../domain/evidenceOptions";
import type { EvidenceRef, EvidenceRole } from "../domain/types";
import type { UploadedFileMeta } from "../state/uploadStore";

function describe(file: EvidenceRef, qid: string): string {
  if (file.option_code === OTHER_OPTION.code) {
    return file.description ? `Other — ${file.description}` : OTHER_OPTION.label;
  }
  return labelForDocType(file.doc_type, qid);
}

/** One attached document, with its role when the question distinguishes the two. */
function AttachedRow({
  file,
  qid,
  showRole,
  uploadUrl,
  onRemove,
}: {
  file: EvidenceRef;
  qid: string;
  showRole: boolean;
  uploadUrl?: string | null;
  onRemove: () => void;
}) {
  const fileName = evidenceFileName(file);
  const isSupporting = file.role === "supporting";
  return (
    <div className="evidence">
      <span className="evidence-icon">
        <FileTextIcon size={17} />
      </span>
      <span className="evidence-meta">
        <span className="evidence-name">
          {uploadUrl ? (
            <a className="evidence-link" href={uploadUrl} target="_blank" rel="noreferrer">
              {fileName}
              <ExternalLinkIcon size={11} />
            </a>
          ) : (
            fileName
          )}
          {showRole && (
            <span className={`evidence-role${isSupporting ? " is-supporting" : ""}`}>
              {isSupporting ? "Supporting" : "Primary"}
            </span>
          )}
        </span>
        <span className="evidence-sub">{describe(file, qid)} · attached</span>
      </span>
      <button
        type="button"
        className="btn-remove"
        onClick={onRemove}
        aria-label={`Remove ${fileName}`}
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

/** The document-type picker plus the attach button, used for both roles. */
function Picker({
  qid,
  role,
  options,
  fileTypes,
  onAttach,
}: {
  qid: string;
  role: EvidenceRole;
  options: EvidenceOption[];
  fileTypes?: string[];
  onAttach: (optionCode: string, description?: string) => void;
}) {
  const isSupporting = role === "supporting";
  const [optionCode, setOptionCode] = useState(() =>
    isSupporting ? "" : defaultOptionCodeFor(qid)
  );
  const [description, setDescription] = useState("");

  const isOther = optionCode === OTHER_OPTION.code;
  const canAttach = optionCode !== "" && (!isOther || description.trim() !== "");
  const selected = optionCode ? findOption(qid, optionCode) : undefined;
  const selectId = `evidence-type-${role}-${qid}`;
  const describeId = `evidence-describe-${role}-${qid}`;

  const attach = () => {
    if (!canAttach) return;
    onAttach(optionCode, isOther ? description.trim() : undefined);
    setOptionCode(isSupporting ? "" : defaultOptionCodeFor(qid));
    setDescription("");
  };

  return (
    <div className={`evidence evidence-pending${isSupporting ? " is-supporting" : ""}`}>
      <span className="evidence-icon is-pending">
        <UploadIcon size={17} />
      </span>

      <div className="evidence-picker">
        <label className="field-label" htmlFor={selectId}>
          {isSupporting ? "Supporting document (optional)" : "Document type"}
        </label>
        <select
          id={selectId}
          className="input input-sm"
          value={optionCode}
          onChange={(e) => setOptionCode(e.target.value)}
        >
          <option value="" disabled>
            {isSupporting
              ? "Add a second document to cross-check…"
              : "Select the document you are attaching…"}
          </option>
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>

        {isOther && (
          <input
            id={describeId}
            className="input input-sm"
            type="text"
            placeholder="Describe the document you are attaching"
            aria-label="Describe the document you are attaching"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}

        {selected && (
          <span className="evidence-formats">Accepts {formatHint(selected, fileTypes)}</span>
        )}
      </div>

      <button type="button" className="btn btn-ghost btn-sm" disabled={!canAttach} onClick={attach}>
        {isSupporting ? "Attach supporting" : "Attach document"}
      </button>
    </div>
  );
}

/**
 * Shown while a file is dragged over the question. Each document type is its own drop target,
 * so the filer states what the document *is* at the moment they attach it, rather than having
 * it guessed from the file name.
 */
function DropTypePanel({
  options,
  role,
  fileTypes,
  suggestedCode,
  fileName,
  onPick,
  onCancel,
}: {
  options: EvidenceOption[];
  role: EvidenceRole;
  fileTypes?: string[];
  suggestedCode?: string;
  fileName: string;
  onPick: (optionCode: string) => void;
  onCancel: () => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      className="droptype"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // Released on the panel but not on a type: nothing is attached, since choosing the
        // type is the point of the panel.
        e.preventDefault();
        onCancel();
      }}
    >
      <p className="droptype-head">
        Drop <strong>{fileName}</strong> on its document type
        {role === "supporting" && <span className="droptype-role">supporting</span>}
      </p>

      <ul className="droptype-list">
        {options.map((option) => (
          <li
            key={option.code}
            className={`droptype-option${hovered === option.code ? " is-over" : ""}${
              option.code === suggestedCode ? " is-suggested" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setHovered(option.code);
            }}
            onDragLeave={() => setHovered((c) => (c === option.code ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setHovered(null);
              onPick(option.code);
            }}
          >
            <span className="droptype-label">{option.label}</span>
            <span className="droptype-meta">
              {option.code === suggestedCode && (
                <span className="droptype-suggested">matches name</span>
              )}
              <span className="droptype-formats">{formatHint(option, fileTypes)}</span>
            </span>
          </li>
        ))}
      </ul>
      <span className="droptype-hint">Release outside the list to cancel.</span>
    </div>
  );
}

export default function EvidenceBlock({
  qid,
  evidence,
  fileTypes,
  allowSupporting,
  uploadUrlFor,
  draggingFile,
  onDropUpload,
  onAttach,
  onRemove,
}: {
  qid: string;
  evidence: EvidenceRef[];
  /** Reviewer-configured formats. Omitted where configuration does not apply. */
  fileTypes?: string[];
  /** Reviewer-configured second slot. Falls back to the published rule for the question. */
  allowSupporting?: boolean;
  /** Resolves an uploaded file to an openable URL, when one backs the attachment. */
  uploadUrlFor?: (uploadId: string) => string | null;
  /**
   * The file currently being dragged from the evidence bundle. It is passed down rather than
   * read from the drag event because dataTransfer payloads are only readable on drop, not
   * while hovering — and the panel has to name the file before it is released.
   */
  draggingFile?: UploadedFileMeta | null;
  onDropUpload?: (uploadId: string, role: EvidenceRole, optionCode: string) => void;
  onAttach: (optionCode: string, role: EvidenceRole, description?: string) => void;
  onRemove: (docType: string) => void;
}) {
  const allowsSupporting = allowSupporting ?? acceptsSupportingEvidence(qid);
  // Drafts seeded before roles existed carry no role, and are the primary document.
  const primary = evidence.filter((e) => e.role !== "supporting");
  const supporting = evidence.filter((e) => e.role === "supporting");
  const [armed, setArmed] = useState(false);

  // A dragged file fills the primary slot, or the supporting one once the primary is taken on
  // a question that accepts two.
  const dropRole: EvidenceRole =
    primary.length > 0 && allowsSupporting && supporting.length === 0 ? "supporting" : "primary";

  const canDrop = Boolean(onDropUpload && draggingFile);
  const showPanel = canDrop && armed;

  // A type already attached is not offered again for the supporting slot; a primary drop may
  // replace what is there. "Other" can always repeat.
  const dropOptions = evidenceOptionsFor(qid).filter(
    (o) =>
      o.code === OTHER_OPTION.code ||
      dropRole === "primary" ||
      !evidence.some((e) => e.doc_type === o.docType)
  );

  const suggestedCode = draggingFile
    ? optionForUpload(qid, draggingFile.name)?.code
    : undefined;

  const armProps = canDrop
    ? {
        onDragEnter: (e: React.DragEvent) => {
          e.preventDefault();
          setArmed(true);
        },
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy" as const;
        },
        onDragLeave: (e: React.DragEvent) => {
          // Ignore the leave events fired while crossing between child elements.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setArmed(false);
        },
      }
    : {};

  const panel = showPanel ? (
    <DropTypePanel
      options={dropOptions}
      role={dropRole}
      fileTypes={fileTypes}
      suggestedCode={suggestedCode}
      fileName={draggingFile!.name}
      onPick={(optionCode) => {
        setArmed(false);
        onDropUpload!(draggingFile!.id, dropRole, optionCode);
      }}
      onCancel={() => setArmed(false)}
    />
  ) : null;

  if (primary.length === 0) {
    return (
      <div className="evidence-dropzone" {...armProps}>
        {panel ?? (
          <>
            <Picker
              qid={qid}
              role="primary"
              options={evidenceOptionsFor(qid)}
              fileTypes={fileTypes}
              onAttach={(code, description) => onAttach(code, "primary", description)}
            />
            {onDropUpload && (
              <span className="dropzone-hint">or drag a file here from the evidence bundle</span>
            )}
          </>
        )}
      </div>
    );
  }

  const remaining = allowsSupporting
    ? evidenceOptionsFor(qid).filter(
        (o) => o.code === OTHER_OPTION.code || !evidence.some((e) => e.doc_type === o.docType)
      )
    : [];

  if (panel) {
    return (
      <div className="evidence-dropzone" {...armProps}>
        {panel}
      </div>
    );
  }

  return (
    <div className="evidence-list evidence-dropzone" {...armProps}>
      {[...primary, ...supporting].map((file) => (
        <AttachedRow
          key={`${file.role ?? "primary"}-${file.doc_type}`}
          file={file}
          qid={qid}
          showRole={allowsSupporting}
          uploadUrl={file.upload_id ? uploadUrlFor?.(file.upload_id) : null}
          onRemove={() => onRemove(file.doc_type)}
        />
      ))}

      {allowsSupporting && supporting.length === 0 && remaining.length > 0 && (
        <Picker
          qid={qid}
          role="supporting"
          options={remaining}
          fileTypes={fileTypes}
          onAttach={(code, description) => onAttach(code, "supporting", description)}
        />
      )}
    </div>
  );
}

import { useState } from "react";
import {
  acceptsSupportingEvidence,
  defaultOptionCodeFor,
  evidenceFileName,
  evidenceOptionsFor,
  findOption,
  formatHint,
  labelForDocType,
  OTHER_OPTION,
} from "../domain/evidenceOptions";
import { FileTextIcon, UploadIcon, XIcon } from "./icons";
import type { EvidenceOption } from "../domain/evidenceOptions";
import type { EvidenceRef, EvidenceRole } from "../domain/types";

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
  onRemove,
}: {
  file: EvidenceRef;
  qid: string;
  showRole: boolean;
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
          {fileName}
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

export default function EvidenceBlock({
  qid,
  evidence,
  fileTypes,
  allowSupporting,
  onAttach,
  onRemove,
}: {
  qid: string;
  evidence: EvidenceRef[];
  /** Reviewer-configured formats. Omitted where configuration does not apply. */
  fileTypes?: string[];
  /** Reviewer-configured second slot. Falls back to the published rule for the question. */
  allowSupporting?: boolean;
  onAttach: (optionCode: string, role: EvidenceRole, description?: string) => void;
  onRemove: (docType: string) => void;
}) {
  const allowsSupporting = allowSupporting ?? acceptsSupportingEvidence(qid);
  // Drafts seeded before roles existed carry no role, and are the primary document.
  const primary = evidence.filter((e) => e.role !== "supporting");
  const supporting = evidence.filter((e) => e.role === "supporting");

  if (primary.length === 0) {
    return (
      <Picker
        qid={qid}
        role="primary"
        options={evidenceOptionsFor(qid)}
        fileTypes={fileTypes}
        onAttach={(code, description) => onAttach(code, "primary", description)}
      />
    );
  }

  const remaining = allowsSupporting
    ? evidenceOptionsFor(qid).filter(
        (o) => o.code === OTHER_OPTION.code || !evidence.some((e) => e.doc_type === o.docType)
      )
    : [];

  return (
    <div className="evidence-list">
      {[...primary, ...supporting].map((file) => (
        <AttachedRow
          key={`${file.role ?? "primary"}-${file.doc_type}`}
          file={file}
          qid={qid}
          showRole={allowsSupporting}
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

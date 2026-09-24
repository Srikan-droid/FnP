import { useState } from "react";
import {
  defaultOptionCodeFor,
  evidenceOptionsFor,
  labelForDocType,
  OTHER_OPTION,
} from "../domain/evidenceOptions";
import { FileTextIcon, UploadIcon, XIcon } from "./icons";
import type { EvidenceRef } from "../domain/types";

function describe(file: EvidenceRef): string {
  if (file.option_code === OTHER_OPTION.code) {
    return file.description ? `Other — ${file.description}` : OTHER_OPTION.label;
  }
  return labelForDocType(file.doc_type);
}

export default function EvidenceBlock({
  qid,
  evidence,
  onAttach,
  onRemove,
}: {
  qid: string;
  evidence: EvidenceRef[];
  onAttach: (optionCode: string, description?: string) => void;
  onRemove: (docType: string) => void;
}) {
  const options = evidenceOptionsFor(qid);
  const [optionCode, setOptionCode] = useState(() => defaultOptionCodeFor(qid));
  const [description, setDescription] = useState("");

  if (evidence.length > 0) {
    return (
      <div className="evidence-list">
        {evidence.map((file) => {
          const fileName = file.path.split("/").pop() ?? file.path;
          return (
            <div className="evidence" key={file.doc_type}>
              <span className="evidence-icon">
                <FileTextIcon size={17} />
              </span>
              <span className="evidence-meta">
                <span className="evidence-name">{fileName}</span>
                <span className="evidence-sub">{describe(file)} · attached</span>
              </span>
              <button
                type="button"
                className="btn-remove"
                onClick={() => onRemove(file.doc_type)}
                aria-label={`Remove ${fileName}`}
                title="Remove attachment"
              >
                <XIcon size={14} />
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  const isOther = optionCode === OTHER_OPTION.code;
  const canAttach = optionCode !== "" && (!isOther || description.trim() !== "");
  const selectId = `evidence-type-${qid}`;
  const describeId = `evidence-describe-${qid}`;

  const attach = () => {
    if (!canAttach) return;
    onAttach(optionCode, isOther ? description.trim() : undefined);
    setDescription("");
  };

  return (
    <div className="evidence evidence-pending">
      <span className="evidence-icon is-pending">
        <UploadIcon size={17} />
      </span>

      <div className="evidence-picker">
        <label className="field-label" htmlFor={selectId}>
          Document type
        </label>
        <select
          id={selectId}
          className="input input-sm"
          value={optionCode}
          onChange={(e) => setOptionCode(e.target.value)}
        >
          <option value="" disabled>
            Select the document you are attaching…
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
      </div>

      <button type="button" className="btn btn-ghost btn-sm" disabled={!canAttach} onClick={attach}>
        Attach document
      </button>
    </div>
  );
}

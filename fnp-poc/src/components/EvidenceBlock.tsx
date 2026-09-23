import { evidenceUrl } from "../data/fixtures";
import { ExternalLinkIcon, FileTextIcon, UploadIcon, XIcon } from "./icons";
import type { EvidenceRef } from "../domain/types";

const prettyDocType = (docType: string) => docType.replaceAll("_", " ");

export default function EvidenceBlock({
  applicantId,
  evidence,
  docType,
  onAttach,
  onRemove,
}: {
  applicantId: string;
  evidence: EvidenceRef[];
  docType: string;
  onAttach: () => void;
  onRemove: (docType: string) => void;
}) {
  if (evidence.length === 0) {
    return (
      <div className="evidence evidence-pending">
        <span className="evidence-icon is-pending">
          <UploadIcon size={17} />
        </span>
        <span className="evidence-meta">
          <span className="evidence-name is-doctype">{prettyDocType(docType)}</span>
          <span className="evidence-sub">Supporting document required — not attached yet</span>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAttach}>
          Attach document
        </button>
      </div>
    );
  }

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
              <span className="evidence-sub">{prettyDocType(file.doc_type)} · attached</span>
            </span>
            <a
              className="btn btn-ghost btn-sm"
              href={evidenceUrl(applicantId, fileName)}
              target="_blank"
              rel="noreferrer"
            >
              View
              <ExternalLinkIcon size={13} />
            </a>
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

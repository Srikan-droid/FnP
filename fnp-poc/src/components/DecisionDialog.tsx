import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangleIcon, CheckCircleIcon } from "./icons";
import type { RulingVerdict } from "../state/caseStore";
import type { Band } from "../domain/types";

/** The reviewer's final call on a scored assessment. Remarks are required either way. */
export default function DecisionDialog({
  verdict,
  applicantName,
  band,
  riskScore,
  onConfirm,
  onCancel,
}: {
  verdict: RulingVerdict;
  applicantName: string;
  band: Band;
  riskScore: number;
  onConfirm: (remarks: string) => void;
  onCancel: () => void;
}) {
  const [remarks, setRemarks] = useState("");
  const isAccept = verdict === "accepted";
  const canConfirm = remarks.trim().length > 0;

  return createPortal(
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`modal-banner ${isAccept ? "is-good" : "is-critical"}`}>
          {isAccept ? <CheckCircleIcon size={17} /> : <AlertTriangleIcon size={17} />}
          <div>
            <h2 id="decision-title">{isAccept ? "Accept this assessment" : "Reject this assessment"}</h2>
            <p>
              {isAccept
                ? "The assessment closes as accepted. Your remarks are recorded on the case and shown to the applicant."
                : "The assessment closes as rejected. Your remarks are recorded on the case and shown to the applicant."}
            </p>
          </div>
        </div>

        <dl className="modal-detail">
          <div>
            <dt>Applicant</dt>
            <dd>{applicantName}</dd>
          </div>
          <div>
            <dt>Risk score</dt>
            <dd>
              {riskScore.toFixed(1)} · {band}
            </dd>
          </div>
        </dl>

        <div className="field">
          <label className="field-label" htmlFor="decision-remarks">
            Remarks
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id="decision-remarks"
            className="input textarea"
            rows={4}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={
              isAccept
                ? "Record any conditions or monitoring attached to the approval."
                : "Record the grounds for rejection."
            }
            autoFocus
          />
          {!canConfirm && <p className="field-hint">Remarks are required.</p>}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`btn ${isAccept ? "btn-primary" : "btn-critical"}`}
            disabled={!canConfirm}
            onClick={() => onConfirm(remarks.trim())}
          >
            {isAccept ? "Accept assessment" : "Reject assessment"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangleIcon, InfoIcon } from "./icons";
import type { RulingVerdict } from "../state/caseStore";

/**
 * Accepting a flagged answer overrides a finding the engine made against the evidence, so the
 * reviewer is told plainly what they are doing and has to give a reason. Rejecting agrees with
 * the engine, so it needs a reason but no warning.
 */
export default function OverrideDialog({
  qid,
  question,
  verdict,
  failingChecks,
  onConfirm,
  onCancel,
}: {
  qid: string;
  question: string;
  verdict: RulingVerdict;
  failingChecks: string[];
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const isOverride = verdict === "accepted";
  const canConfirm = comment.trim().length > 0;

  return createPortal(
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="override-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`modal-banner ${isOverride ? "is-critical" : "is-info"}`}>
          {isOverride ? <AlertTriangleIcon size={17} /> : <InfoIcon size={17} />}
          <div>
            <h2 id="override-title">
              {isOverride ? "You are overriding the AI assessment" : "Reject this answer"}
            </h2>
            <p>
              {isOverride
                ? "The engine could not authenticate this answer against the evidence. Accepting it records your judgment in place of that finding, and the answer will be scored as submitted."
                : "The applicant will be asked to attach new evidence for this question, and the assessment returns for authentication."}
            </p>
          </div>
        </div>

        <dl className="modal-detail">
          <div>
            <dt>Question</dt>
            <dd>
              <span className="qid">{qid}</span> {question}
            </dd>
          </div>
          {failingChecks.length > 0 && (
            <div>
              <dt>Engine finding</dt>
              <dd>{failingChecks.join("; ")}</dd>
            </div>
          )}
        </dl>

        <div className="field">
          <label className="field-label" htmlFor="override-comment">
            {isOverride ? "Reason for accepting" : "What the applicant must provide"}
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id="override-comment"
            className="input textarea"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              isOverride
                ? "Record why the evidence is acceptable despite the finding."
                : "Name the document or correction you need."
            }
            autoFocus
          />
          {!canConfirm && <p className="field-hint">A comment is required and is kept on the case.</p>}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`btn ${isOverride ? "btn-critical" : "btn-primary"}`}
            disabled={!canConfirm}
            onClick={() => onConfirm(comment.trim())}
          >
            {isOverride ? "Override and accept" : "Reject and return"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

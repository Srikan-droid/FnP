import { PencilIcon, PlusIcon, XIcon } from "../icons";
import { TOTAL, hundredths, isEdited, show, summaryLine } from "../../domain/questionWeights";
import type { EditQuestion } from "../../domain/questionWeights";

/**
 * One question, compact: its code and text, its share of the section (typed here, as the most
 * frequent change) and the weight that follows, as part of the section's weight and of 100, and
 * its settings in a line. Edit opens the question's settings in the panel.
 */
export default function QuestionRow({
  question: q,
  code,
  parentCode,
  weight,
  sectionWeight,
  problem,
  checkId,
  pctInvalid,
  deleteDisabledReason,
  onPct,
  onEdit,
  onUndo,
  onDelete,
  onAddFollowUp,
}: {
  question: EditQuestion;
  /** Its code: as published, or the one applying will give a question added now (null: unknown). */
  code: string | null;
  /** Its parent's code, the same way (a follow-up only). */
  parentCode?: string | null;
  /** Its weight of 100, in hundredths (null while a number is not valid). */
  weight: number | null;
  /** Its section's weight of 100, in hundredths (null while not a valid number). */
  sectionWeight: number | null;
  problem: string | null;
  /** The section's percentage check, which the percentage field is described by. */
  checkId: string;
  pctInvalid: boolean;
  /** Why it cannot be deleted, if it cannot (the only question in its section). */
  deleteDisabledReason: string | null;
  onPct: (pct: string) => void;
  onEdit: () => void;
  onUndo: () => void;
  onDelete: () => void;
  /** Adds a follow-up question under this one (a Yes / No question that is not a follow-up itself). */
  onAddFollowUp?: () => void;
}) {
  const edited = isEdited(q);
  const name = code ?? "the new question";
  const isNew = q.qid === null;
  const pct = hundredths(q.pct);
  const shown = weight === null ? "—" : show(weight);
  return (
    <article className={`qrow${problem ? " is-off" : ""}${q.parentKey ? " is-follow-up" : ""}`}>
      <div className="qrow-main">
        <span className="qid">{code ?? "New"}</span>
        <div className="qrow-text">
          {q.parentKey && (
            <p className="qrow-follow-up">
              Follow-up · asked when {parentCode ?? "the question above"} is {q.showWhen}
            </p>
          )}
          <p className="qrow-question">{q.text.trim() || <span className="qrow-placeholder">No question text yet</span>}</p>
          <p className="qrow-summary">{summaryLine(q)}</p>
          {problem && <p className="field-error qrow-problem">{problem}</p>}
        </div>
        <div className="qrow-badges">
          {isNew && <span className="chip chip-info">New</span>}
          {edited && <span className="chip chip-serious">Edited</span>}
        </div>
      </div>

      <div className="qrow-side">
        {q.parentKey ? (
          // No weight of its own: it counts under its parent's.
          <p className="qrow-no-weight">No weight of its own · counts under {parentCode ?? "its parent"}</p>
        ) : (
        <div className="qrow-weight">
          <label className="sr-only" htmlFor={`p-${q.key}`}>
            Percentage of the section for {name}
          </label>
          <div className="input-suffix qrow-pct">
            <input
              id={`p-${q.key}`}
              className="input input-num"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={q.pct}
              aria-invalid={pctInvalid || hundredths(q.pct) === null || undefined}
              aria-describedby={checkId}
              onChange={(e) => onPct(e.target.value)}
            />
            <span aria-hidden="true">%</span>
          </div>
          {/* Its weight comes out of the section's: how much of it, and of 100 overall. */}
          <div className="qrow-of" id={`w-${q.key}`} data-weight={weight === null ? "" : show(weight)}>
            <span className="qrow-of-line">
              = <strong>{shown}</strong> of the section's {sectionWeight === null ? "—" : show(sectionWeight)}
            </span>
            <span className="qrow-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(pct ?? 0, TOTAL) / 100}%` }} />
            </span>
            <span className="qrow-of-overall">{shown} of 100 overall</span>
          </div>
        </div>
        )}
        <div className="qrow-actions">
          {edited && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onUndo}>
              Undo changes
            </button>
          )}
          {onAddFollowUp && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onAddFollowUp}
              aria-label={`Add a follow-up question to ${name}`}
              title="A question asked only when this one has a given answer"
            >
              <PlusIcon size={13} />
              Follow-up
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} aria-label={`Edit ${name}`}>
            <PencilIcon size={13} />
            Edit
          </button>
          <button
            type="button"
            className="icon-button qconfig-delete"
            aria-label={`Delete question ${code ?? ""}`.trim()}
            title={deleteDisabledReason ?? "Delete question"}
            disabled={deleteDisabledReason !== null}
            onClick={onDelete}
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

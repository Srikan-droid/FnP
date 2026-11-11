import { latestReviewLabel, reviewLine } from "../domain/reviewLabels";
import type { ReviewEntry } from "../api/types";

/**
 * What the reviewer last did with a question, as a small label after its outcome ("Accepted by
 * reviewer", "Overridden by reviewer" ...). Earlier rulings are in the opened row.
 */
export function ReviewChips({ entries }: { entries?: ReviewEntry[] }) {
  const label = latestReviewLabel(entries);
  if (!label) return null;
  // Words only: a small icon beside them shrank to a dot once the label wrapped in a narrow column.
  return (
    <span className="review-chips">
      <span className={`chip chip-${label.tone} chip-review is-${label.kind}`} title={label.title}>
        {label.text}
      </span>
    </span>
  );
}

/** The reviewer's latest ruling on a question, with its comment, shown when its row is opened. */
export function ReviewNotes({ entries }: { entries?: ReviewEntry[] }) {
  const latest = entries?.[entries.length - 1];
  if (!latest) return null;
  return (
    <div className="review-notes">
      <p className="review-notes-title">Reviewer</p>
      <ul>
        <li>
          <span className="review-notes-line">{reviewLine(latest)}</span>
          {latest.comment && <span className="review-notes-comment">“{latest.comment}”</span>}
        </li>
      </ul>
    </div>
  );
}

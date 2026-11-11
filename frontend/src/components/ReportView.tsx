import { useState } from "react";
import ScoreVerdict from "./ScoreVerdict";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  InfoIcon,
} from "./icons";
import { displaySection } from "../domain/sectionLabels";
import { reportQuestions } from "../api/adapt";
import AnswerTag from "./AnswerTag";
import ConcernCard from "./ConcernCard";
import { ReviewChips, ReviewNotes } from "./ReviewMarks";
import { concernKey, type Concern } from "../domain/concerns";
import { noRisk, sectionTotals, type SectionTotal } from "../domain/riskSections";
import type {
  AuthenticationOutcome,
  ScoreResult,
  SectionScoreLine,
} from "../domain/types";
import type { ReviewEntry } from "../api/types";

/** Outcome cell, shared by every question row. */
function OutcomeTag({ line }: { line: SectionScoreLine }) {
  if (line.answer === "N/A") return <span className="chip chip-neutral">Not applicable</span>;
  if (line.riskFlag)
    return (
      <span className="chip chip-critical">
        <AlertTriangleIcon size={13} />
        Risk
      </span>
    );
  return (
    <span className="chip chip-low">
      <CheckCircleIcon size={13} />
      Clear
    </span>
  );
}

/**
 * One question's line in the breakdown. A line that carries risk, that the AI engine wrote a
 * concern about, or that the reviewer ruled on, opens to the question, the reviewer's rulings and
 * the AI engine's concern (as the assessment summary shows them). What the reviewer did shows as
 * labels after the outcome.
 */
function QuestionRow({
  line: l,
  concerns,
  reviews,
}: {
  line: SectionScoreLine;
  concerns: Concern[];
  reviews?: ReviewEntry[];
}) {
  const [open, setOpen] = useState(false);
  const reviewed = (reviews?.length ?? 0) > 0;
  const expandable = l.riskFlag === 1 || concerns.length > 0 || reviewed;
  const detailId = `risk-detail-${l.qid.replace(/[^a-z0-9]+/gi, "-")}`;
  const rowClass = [l.knockOutTriggered && "row-knockout", open && "is-open"].filter(Boolean).join(" ");

  return (
    <>
      <tr className={rowClass || undefined}>
        <td>
          <span className="qid">{l.qid}</span>
        </td>
        <td>
          <AnswerTag answer={l.answer} />
        </td>
        <td className="num">{l.applicableWeight}</td>
        <td>
          {expandable ? (
            <button
              type="button"
              className="outcome-toggle"
              aria-expanded={open}
              aria-controls={detailId}
              title={open ? "Hide the details" : l.riskFlag === 1 ? "Show why this question carries risk" : "Show the details"}
              onClick={() => setOpen((v) => !v)}
            >
              <OutcomeTag line={l} />
              <span className="outcome-toggle-chevron">
                <ChevronDownIcon size={13} />
              </span>
            </button>
          ) : (
            <OutcomeTag line={l} />
          )}
          <ReviewChips entries={reviews} />
        </td>
        <td className="num strong">{l.weightedRisk.toFixed(1)}</td>
      </tr>
      {expandable && open && (
        <tr className="risk-detail-row" id={detailId}>
          <td colSpan={5}>
            <div className="risk-detail">
              {l.question && <p className="risk-detail-question">{l.question}</p>}
              {l.knockOutTriggered && (
                <p className="risk-detail-note risk-detail-knockout">
                  <AlertOctagonIcon size={14} />
                  This is a knock-out question: the case is referred regardless of the weighted score.
                </p>
              )}
              <ReviewNotes entries={reviews} />
              {concerns.map((c, i) => (
                <ConcernCard key={concernKey(c, i)} concern={c} showSection={false} />
              ))}
              {/* A risky answer the AI engine wrote nothing about says why it counts. */}
              {concerns.length === 0 && l.riskFlag === 1 && (
                <p className="risk-detail-note">
                  <InfoIcon size={14} />
                  The answer "{l.answer}" counts as a risk for this question, adding{" "}
                  {l.weightedRisk.toFixed(1)} to the score. The AI engine wrote no further concern
                  about it.
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** A section's contribution, expanding to the questions that produced it. */
function SectionRow({
  total,
  concerns,
  reviews,
}: {
  total: SectionTotal;
  concerns: Concern[];
  reviews?: Record<string, ReviewEntry[]>;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = `risk-${total.section.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <div className={`sbar-group${open ? " is-open" : ""}`}>
      <button
        className="sbar-row"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sbar-chevron">
          <ChevronDownIcon size={14} />
        </span>
        <span className="sbar-label">{displaySection(total.section)}</span>
        <span className="sbar-track">
          <span
            className="sbar-fill"
            style={{ width: `${(total.risk / total.weight) * 100}%` }}
          />
        </span>
        <span className="sbar-value">
          {noRisk(total) ? (
            // Every question clear: said in words in place of "0.0 / 18".
            <span className="chip chip-low chip-norisk">No risk</span>
          ) : (
            <>
              {total.risk.toFixed(1)}
              <span className="sbar-denom"> / {total.weight}</span>
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="sbar-detail" id={bodyId}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Answer</th>
                <th scope="col" className="num">
                  Weight
                </th>
                <th scope="col">Outcome</th>
                <th scope="col" className="num">
                  Contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {total.lines.map((l) => (
                <QuestionRow
                  key={l.qid}
                  line={l}
                  concerns={concerns.filter((c) => c.qid === l.qid)}
                  reviews={reviews?.[l.qid]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReportView({
  authentication,
  scoreResult,
  concerns = [],
  reviews,
}: {
  authentication: AuthenticationOutcome;
  scoreResult: ScoreResult;
  /** The AI engine's concerns from its written assessment, shown under the questions they are about. */
  concerns?: Concern[];
  /** Each question's rulings across the case's runs (Case.reviewHistory), as labels and notes. */
  reviews?: Record<string, ReviewEntry[]>;
}) {
  const cautions = reportQuestions(authentication).filter((q) => q.checks.some((c) => c.status === "caution"));
  const sections = sectionTotals(scoreResult);

  return (
    <div className="report">
      <ScoreVerdict scoreResult={scoreResult} />

      {scoreResult.knockOutTriggered && (
        <div className="notice notice-critical">
          <AlertOctagonIcon size={17} />
          <div>
            <strong>Knock-out triggered.</strong> {scoreResult.knockOutReason} The case is referred
            regardless of the weighted score.
          </div>
        </div>
      )}

      {cautions.length > 0 && (
        <div className="notice notice-info">
          <InfoIcon size={17} />
          <div>
            <strong>
              {cautions.length} question{cautions.length > 1 ? "s" : ""} authenticated at reduced
              confidence
            </strong>{" "}
            ({cautions.map((q) => q.qid).join(", ")}). Scoring treats them as authenticated — see
            the authentication report for why.
          </div>
        </div>
      )}

      <section className="card">
        <header className="card-head">
          <h2>Where the risk comes from</h2>
          <p className="card-sub">
            Weighted risk points contributed by each section, against that section's maximum.
            Select a section to see the questions behind it, and a question's Risk outcome to see
            why.
          </p>
        </header>

        <div className="sectionbars">
          {sections.map((s) => (
            <SectionRow key={s.section} total={s} concerns={concerns} reviews={reviews} />
          ))}

          <div className="sbar-total">
            <span className="sbar-total-label">Total</span>
            <span className="sbar-total-value">
              {scoreResult.totalWeightedRisk.toFixed(1)}
              <span className="sbar-denom"> / {scoreResult.totalApplicableWeight}</span>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  DownloadIcon,
  InfoIcon,
  XIcon,
} from "./icons";
import ConcernCard from "./ConcernCard";
import RiskBreakdown from "./RiskBreakdown";
import ScoreVerdict from "./ScoreVerdict";
import QuestionOutcomes from "./QuestionOutcomes";
import { concernKey } from "../domain/concerns";
import { detailedQids } from "../domain/riskSections";
import { reviewedQids } from "../domain/reviewLabels";
import { summaryPoints } from "../domain/summaryPoints";
import type { Assessment, Case, FinalAssessment, ReviewEntry } from "../api/types";
import type { ScoreResult } from "../domain/types";

const VERDICT_TONE: Record<string, string> = {
  APPROVE: "low",
  CONDITIONAL: "warning",
  REFER: "serious",
  REJECT: "critical",
};

/** "3 Oct 2026" from a timestamp. */
function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The engine lists question outcomes as "A1, A4, Q1": shown as the question tags used everywhere
 * else. Anything that is not such a list is shown as written.
 */
function QuestionIds({ list }: { list?: string | string[] | null }) {
  // The engine leaves an outcome out when no question has it, and may send a list instead of text.
  const text = Array.isArray(list) ? list.join(", ") : typeof list === "string" ? list : "";
  const ids = text
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return <dd className="pane-qsplit-none">None</dd>;
  if (ids.some((id) => /\s/.test(id))) return <dd>{text}</dd>;
  return (
    <dd className="pane-qids">
      {ids.map((id) => (
        <span className="qid" key={id}>
          {id}
        </span>
      ))}
    </dd>
  );
}

/** A value for a CSS string: printed in the page footer, so quotes and backslashes are escaped. */
const cssString = (value: string) => `"${value.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ")}"`;

/**
 * Identifies the case at the top of the printed summary, so the PDF still says whose assessment it
 * is, for what, and where it stands once it has left the app. Hidden on screen, where the page
 * behind the pane already says all of this.
 */
function PrintHeader({ assignment }: { assignment: Assessment }) {
  return (
    <header className="pane-print-head">
      <div className="pane-print-brand">
        <img className="pane-print-logo" src="/brand/iris-logo.png" alt="iRIS" width="38" height="24" />
        <span>Fit and Proper Assessment</span>
        <span className="pane-print-doc">Assessment summary</span>
      </div>
      <h1 className="pane-print-name">{assignment.applicantName}</h1>
      <p className="pane-print-role">
        {assignment.position} · {assignment.entity}
      </p>
      <dl className="pane-print-meta">
        <div>
          <dt>Assessment</dt>
          <dd>{assignment.id}</dd>
        </div>
        <div>
          <dt>Application reference</dt>
          <dd>{assignment.reference}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>{assignment.department.name}</dd>
        </div>
      </dl>
    </header>
  );
}

/**
 * The reviewer's decision and the feedback they gave with it, at the top of the summary for both
 * the reviewer and the applicant, and in the PDF. Before a decision, it says the case is waiting.
 */
function ReviewerDecision({ decision }: { decision: Case["decision"] }) {
  if (!decision) {
    return (
      <section className="pane-section pane-decision is-pending">
        <h3>Reviewer's Feedback</h3>
        <p className="pane-prose">Not decided yet. The reviewer's feedback will appear here once given.</p>
      </section>
    );
  }
  const accepted = decision.verdict === "accepted";
  return (
    <section className="pane-section pane-decision">
      <h3>Reviewer's Feedback</h3>
      <div className="pane-decision-head">
        <span className={`chip chip-${accepted ? "low" : "critical"}`}>
          {accepted ? <CheckCircleIcon size={12} /> : <AlertTriangleIcon size={12} />}
          {accepted ? "Accepted" : "Rejected"}
        </span>
        <span className="pane-decision-date">
          {formatDay(decision.at)}
          {/* A bar to the eye, a pause to a screen reader. */}
          <span className="sr-only">, </span>
          <span className="pane-decision-sep" aria-hidden="true">
            |
          </span>
          {/* The account for a reviewer; an applicant is told it was the reviewer. */}
          Decided by{" "}
          {decision.by ? <strong className="pane-decision-by">{decision.by}</strong> : "the reviewer"}
        </span>
      </div>
      <p className="pane-decision-label">Feedback</p>
      <p className="pane-prose pane-decision-feedback">{decision.remarks}</p>
    </section>
  );
}

function Empty({ applicantName }: { applicantName: string }) {
  return (
    <div className="pane-empty">
      <InfoIcon size={20} />
      <p>
        <strong>No assessment summary yet.</strong>
      </p>
      <p>
        There is no written assessment for {applicantName}. The AI engine writes one only for a
        submission in which every answer was authenticated, so there is none when answers were
        flagged (even if the reviewer then accepted them) or when the engine could not produce one.
      </p>
    </div>
  );
}

export default function AssessmentSummaryPane({
  assessment,
  assignment,
  decision,
  scoreResult = null,
  reviews,
  onClose,
}: {
  assessment: FinalAssessment | null;
  /** The case the summary belongs to: printed at the top of the PDF. */
  assignment: Assessment;
  decision: Case["decision"];
  /** The score as the page shows it (null: none to show): its breakdown prints with the PDF. */
  scoreResult?: ScoreResult | null;
  /** Each question's rulings across the case's runs: labelled in the breakdown, as on the scoring page. */
  reviews?: Record<string, ReviewEntry[]>;
  onClose: () => void;
}) {
  const applicantName = assignment.applicantName;

  // Escape closes the pane, as it would any slide-over, and the page behind it stays put.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // While printing, the page title names the case: it is the PDF's default file name and the
  // title in the browser's print header, instead of the app's name for every summary.
  useEffect(() => {
    let previous: string | null = null;
    const before = () => {
      // Kept from the first of any repeated beforeprint events, so the app's title is restored.
      previous ??= document.title;
      document.title = `Assessment summary - ${applicantName} - ${assignment.id}`;
    };
    const after = () => {
      if (previous !== null) document.title = previous;
      previous = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      after();
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [applicantName, assignment.id]);

  const determination = assessment?.determination;
  // Parts the engine may leave out, so a missing one shows as empty rather than breaking the pane.
  const concerns = assessment?.concerns ?? [];
  const strengths = assessment?.strengths ?? [];
  const forSupervisor = assessment?.for_supervisor ?? [];
  // The executive summary as bullet points (the engine sends a paragraph, or lines).
  const summary = summaryPoints(assessment?.executive_summary);
  const outcomes = assessment?.questions ?? {};
  const override = determination?.authentication_override;
  // Each concern shows once, under its question in "Where the risk comes from". Only one with no
  // question there (or every one, when there is no score to break down) is listed on its own.
  const lineQids = new Set(scoreResult?.lines.map((l) => l.qid) ?? []);
  const unplacedConcerns = concerns.filter((c) => !lineQids.has(c.qid));
  // The running footer on every printed page. CSS cannot read the case from the page, so the
  // rule is written with it.
  const pageFooter = `@page { @bottom-left { content: ${cssString(`${assignment.id} · ${applicantName}`)}; } }`;

  // Rendered at the document root: the pane is a modal layer, and printing it as the PDF means
  // hiding everything else under <body>, which only works if it is a sibling of the app root.
  return createPortal(
    <div className="pane-overlay" role="presentation" onClick={onClose}>
      <aside
        className="pane"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assessment-pane-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pane-head">
          <div className="pane-head-text">
            <h2 id="assessment-pane-title">Assessment summary</h2>
            <p className="pane-sub">{applicantName}</p>
          </div>
          <div className="pane-head-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => window.print()}
              disabled={!assessment}
              title={
                assessment
                  ? "Opens the print dialog — choose Save as PDF"
                  : "Nothing to download yet"
              }
            >
              <DownloadIcon size={14} />
              Download as PDF
            </button>
            <button className="pane-close" onClick={onClose} aria-label="Close assessment summary">
              <XIcon size={16} />
            </button>
          </div>
        </header>

        <div className="pane-body">
          <style>{pageFooter}</style>
          <PrintHeader assignment={assignment} />
          <ReviewerDecision decision={decision} />
          {!assessment || !determination ? (
            <Empty applicantName={applicantName} />
          ) : (
            <>
              <section className="pane-section pane-section-verdict">
                <h3>AI review score</h3>
                {scoreResult ? (
                  <>
                    {/* The score as the scoring page shows it. */}
                    <ScoreVerdict scoreResult={scoreResult} framed={false} />
                    {scoreResult.knockOutTriggered && (
                      <p className="pane-override is-knockout" role="note">
                        <AlertOctagonIcon size={14} />
                        <span>
                          <strong>Knock-out triggered.</strong> {scoreResult.knockOutReason} The case is referred
                          regardless of the weighted score.
                        </span>
                      </p>
                    )}
                  </>
                ) : (
                  // No score to hand: the AI engine's own figures.
                  <>
                    <div className="pane-verdict">
                      <span className={`chip chip-${VERDICT_TONE[determination.verdict] ?? "neutral"}`}>
                        {determination.verdict}
                      </span>
                      <span className="pane-verdict-reco">{determination.recommendation}</span>
                    </div>
                    <dl className="pane-stats">
                      <div>
                        <dt>Risk score</dt>
                        <dd>
                          {determination.risk_score}
                          <span className="pane-explain">Out of 100: the higher, the more risk.</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Band</dt>
                        <dd>
                          {determination.risk_band}
                          <span className="pane-explain">Low, Moderate, Elevated or High.</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Weighted risk</dt>
                        <dd>
                          {determination.weighted_risk}
                          <span className="pane-explain">Risk points from the answers, of the most possible.</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Knock-out</dt>
                        <dd>
                          {determination.knock_out_triggered ? "Triggered" : "None"}
                          <span className="pane-explain">An answer that refers the case on its own.</span>
                        </dd>
                      </div>
                    </dl>
                  </>
                )}
                {override?.note && (
                  <p className="pane-override" role="note">
                    <AlertTriangleIcon size={14} />
                    <span>
                      <strong>Scored at the reviewer's request.</strong> {override.note}
                    </span>
                  </p>
                )}
              </section>

              {summary.length > 0 && (
                <section className="pane-section">
                  <h3>Executive summary</h3>
                  <ul className="pane-list pane-list-points">
                    {summary.map((point, i) => (
                      <li key={i}>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Where the risk comes from: risky sections open, each concern under its question. */}
              {scoreResult && <RiskBreakdown scoreResult={scoreResult} concerns={concerns} reviews={reviews} />}

              {unplacedConcerns.length > 0 && (
                <section className="pane-section">
                  <h3>
                    {scoreResult ? "Other concerns and proposed conditions" : "Concerns and proposed conditions"}
                    <span className="pane-count">{unplacedConcerns.length}</span>
                  </h3>
                  <p className="pane-explain pane-section-explain">
                    {scoreResult
                      ? "Concerns about something outside the scored questions above: "
                      : "What the AI engine found that needs attention: "}
                    how serious it judges it, the passage in the evidence it rests on, and the condition
                    proposed against it (COND-…).
                  </p>
                  {unplacedConcerns.map((c, i) => (
                    <ConcernCard concern={c} key={concernKey(c, i)} />
                  ))}
                </section>
              )}

              <section className="pane-section">
                <h3>
                  Strengths<span className="pane-count">{strengths.length}</span>
                </h3>
                <p className="pane-explain pane-section-explain">
                  What the evidence shows in the applicant's favour, by question.
                </p>
                <ul className="pane-list">
                  {strengths.map((s, i) => (
                    <li key={`${s.qid}-${i}`}>
                      <CheckCircleIcon size={14} />
                      <span>
                        <span className="qid">{s.qid}</span> {s.statement}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="pane-section">
                <h3>For the supervisor</h3>
                <p className="pane-explain pane-section-explain">
                  Points the AI engine suggests the supervisor looks into further.
                </p>
                <ul className="pane-list pane-list-questions">
                  {forSupervisor.map((q, i) => (
                    <li key={i}>
                      <AlertTriangleIcon size={14} />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="pane-section">
                <h3>Question outcomes</h3>
                {/* Each outcome explained, with what every question asked; the codes alone when
                    the score's questions are not to hand. */}
                {scoreResult ? (
                  <QuestionOutcomes
                    outcomes={outcomes}
                    lines={scoreResult.lines}
                    detailed={detailedQids(scoreResult, [...concerns.map((c) => c.qid), ...reviewedQids(reviews)])}
                  />
                ) : (
                  <dl className="pane-qsplit">
                    <div>
                      <dt>Passed</dt>
                      <QuestionIds list={outcomes.passed} />
                    </div>
                    <div>
                      <dt>Conditional</dt>
                      <QuestionIds list={outcomes.conditional} />
                    </div>
                    <div>
                      <dt>Not applicable</dt>
                      <QuestionIds list={outcomes.not_applicable} />
                    </div>
                  </dl>
                )}
              </section>

            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

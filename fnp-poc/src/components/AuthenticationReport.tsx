import { useState } from "react";
import type { ReactNode } from "react";
import { issuesIn } from "../domain/authentication";
import { reviewStateFor } from "../domain/reviewState";
import { displaySection } from "../domain/sectionLabels";
import CvVerificationCard from "./CvVerificationCard";
import { AlertTriangleIcon, CheckCircleIcon, ChevronDownIcon, InfoIcon } from "./icons";
import type { QuestionReviewState } from "../domain/reviewState";
import type { AuthenticationOutcome, CheckResult, QuestionAuthResult } from "../domain/types";

const percent = (value: number) => `${Math.round(value * 100)}%`;

const CHECK_TONE: Record<CheckResult["status"], string> = {
  pass: "good",
  caution: "warning",
  fail: "critical",
};

/** How a flagged question reads once a reviewer has ruled on it. */
const REVIEW_CHIP: Record<QuestionReviewState, { label: string; tone: string } | null> = {
  clean: null,
  flagged: { label: "Issue", tone: "critical" },
  overridden: { label: "Accepted by reviewer", tone: "low" },
  rejected: { label: "Rejected by reviewer", tone: "warning" },
};

function CheckIconFor({ status }: { status: CheckResult["status"] }) {
  if (status === "fail") return <AlertTriangleIcon size={14} />;
  if (status === "caution") return <InfoIcon size={14} />;
  return <CheckCircleIcon size={14} />;
}

function QuestionRow({
  result,
  reviewState,
  footer,
}: {
  result: QuestionAuthResult;
  reviewState: QuestionReviewState;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(result.status === "issue");
  const bodyId = `auth-${result.qid}`;
  const chip = REVIEW_CHIP[reviewState];

  return (
    <div className={`auth-question is-${result.status} review-${reviewState}`}>
      <button
        className="auth-question-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="auth-chevron">
          <ChevronDownIcon size={15} />
        </span>
        <span className="qid">{result.qid}</span>
        <span className="auth-question-text">{result.question}</span>

        <span className="auth-question-meta">
          {result.confidence === null ? (
            <span className={`chip chip-${result.status === "issue" ? "critical" : "neutral"}`}>
              {result.status === "issue" ? "No document" : "No checks"}
            </span>
          ) : (
            <>
              <span className={`chip chip-${chip ? chip.tone : "low"}`}>
                {chip ? chip.label : "Authenticated"}
              </span>
              <span className="auth-confidence">{percent(result.confidence)}</span>
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="auth-question-body" id={bodyId}>
          <p className="auth-summary">{result.summary}</p>

          {result.checks.length > 0 && (
            <ul className="check-list">
              {result.checks.map((check) => (
                <li key={check.name} className={`check check-${CHECK_TONE[check.status]}`}>
                  <span className="check-icon">
                    <CheckIconFor status={check.status} />
                  </span>
                  <div className="check-body">
                    <div className="check-head">
                      <span className="check-label">{check.label}</span>
                      <span className="check-confidence">
                        <span className="confidence-track">
                          <span
                            className="confidence-fill"
                            style={{ width: `${check.confidence * 100}%` }}
                          />
                        </span>
                        {percent(check.confidence)}
                      </span>
                    </div>
                    <p className="check-note">{check.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * The authentication report itself, shared by the applicant and the reviewer so the two always
 * see the same findings. `questionFooter` is where each portal adds what only it can do — the
 * reviewer's rulings, or the applicant's replacement evidence.
 */
export default function AuthenticationReport({
  assessmentId,
  outcome,
  notice,
  questionFooter,
}: {
  assessmentId: string;
  outcome: AuthenticationOutcome;
  notice?: ReactNode;
  questionFooter?: (result: QuestionAuthResult) => ReactNode;
}) {
  const issues = issuesIn(outcome);

  return (
    <>
      <section className="card auth-summary-card">
        <div className="auth-stat">
          <span className="auth-stat-label">Overall confidence</span>
          <span className="auth-stat-value">
            {outcome.overallConfidence === null ? "—" : percent(outcome.overallConfidence)}
          </span>
        </div>
        <div className="auth-stat">
          <span className="auth-stat-label">Checks run</span>
          <span className="auth-stat-value">{outcome.checksRun}</span>
        </div>
        <div className="auth-stat">
          <span className="auth-stat-label">Questions with issues</span>
          <span className={`auth-stat-value${issues.length > 0 ? " is-critical" : ""}`}>
            {issues.length}
          </span>
        </div>
      </section>

      {notice}

      {outcome.sections.map((section) => (
        <section className="card section" key={section.section}>
          <div className="section-head section-head-static">
            <span className="section-title">{displaySection(section.section)}</span>
            {section.issueCount > 0 && (
              <span className="section-flag">
                <AlertTriangleIcon size={12} />
                {section.issueCount} issue{section.issueCount > 1 ? "s" : ""}
              </span>
            )}
            <span className="section-count">
              {section.questions.length} question{section.questions.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="section-body">
            {section.questions.map((q) => (
              <QuestionRow
                key={q.qid}
                result={q}
                reviewState={reviewStateFor(assessmentId, q)}
                footer={questionFooter?.(q)}
              />
            ))}
          </div>
        </section>
      ))}

      {outcome.cvVerification && <CvVerificationCard result={outcome.cvVerification} />}
    </>
  );
}

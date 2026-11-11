import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { displaySection } from "../domain/sectionLabels";
import { percent } from "../utils/format";
import CvVerificationCard from "./CvVerificationCard";
import ReadMore from "./ReadMore";
import { useClipped } from "../state/clipped";
import { CheckItem } from "./Confidence";
import { AlertTriangleIcon, CheckCircleIcon, ChevronDownIcon, ExternalLinkIcon, FileTextIcon, InfoIcon } from "./icons";
import { questionsWithIssues } from "../api/adapt";
import type { QuestionReviewState } from "../api/adapt";
import type { AuthenticationOutcome, CheckResult, QuestionAuthResult } from "../domain/types";

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
  // A long question is cut to a line; "Read more", right after its "…", shows it whole.
  const [full, setFull] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const clipped = useClipped(textRef, result.question);

  return (
    <div className={`auth-question is-${result.status} review-${reviewState}`}>
      {/* The toggle's click area covers the whole row, as before; "Read more" sits above it. */}
      <div className="auth-question-head">
        <button
          type="button"
          className="auth-question-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-labelledby={`${bodyId}-qid ${bodyId}-text`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="auth-chevron">
            <ChevronDownIcon size={15} />
          </span>
          <span className="qid" id={`${bodyId}-qid`}>
            {result.qid}
          </span>
        </button>
        <span ref={textRef} id={`${bodyId}-text`} className={`auth-question-text${full ? " is-full" : ""}`}>
          {result.question}
        </span>
        <ReadMore clipped={clipped} full={full} onToggle={() => setFull((v) => !v)} className="auth-read-more" />

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
      </div>

      {open && (
        <div className="auth-question-body" id={bodyId}>
          <p className="auth-summary">{result.summary}</p>

          {result.determination?.highlightUrl && (
            <a
              className="review-evidence-link"
              href={result.determination.highlightUrl}
              target="_blank"
              rel="noreferrer"
            >
              <FileTextIcon size={13} />
              View highlighted evidence
              <ExternalLinkIcon size={11} />
            </a>
          )}

          {result.checks.length > 0 && (
            <ul className="check-list">
              {result.checks.map((check) => (
                <CheckItem
                  key={check.name}
                  check={check}
                  tone={CHECK_TONE[check.status]}
                  icon={<CheckIconFor status={check.status} />}
                />
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
  outcome,
  reviewState,
  notice,
  questionFooter,
}: {
  outcome: AuthenticationOutcome;
  /** Where the reviewer has got to on each question (flagged, overridden, rejected). */
  reviewState: (qid: string) => QuestionReviewState;
  notice?: ReactNode;
  questionFooter?: (result: QuestionAuthResult) => ReactNode;
}) {
  const issues = questionsWithIssues(outcome);

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
                reviewState={reviewState(q.qid)}
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

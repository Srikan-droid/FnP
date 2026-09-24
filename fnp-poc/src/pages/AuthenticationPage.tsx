import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate } from "../domain/authentication";
import { statusFor } from "../state/submissionStore";
import { displaySection } from "../domain/sectionLabels";
import AssessmentNotFound from "../components/AssessmentNotFound";
import OutcomeTabs from "../components/OutcomeTabs";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  InfoIcon,
} from "../components/icons";
import type { CheckResult, QuestionAuthResult } from "../domain/types";

const percent = (value: number) => `${Math.round(value * 100)}%`;

const CHECK_TONE: Record<CheckResult["status"], string> = {
  pass: "good",
  caution: "warning",
  fail: "critical",
};

function CheckIconFor({ status }: { status: CheckResult["status"] }) {
  if (status === "fail") return <AlertTriangleIcon size={14} />;
  if (status === "caution") return <InfoIcon size={14} />;
  return <CheckCircleIcon size={14} />;
}

function QuestionRow({ result }: { result: QuestionAuthResult }) {
  const [open, setOpen] = useState(result.status === "issue");
  const bodyId = `auth-${result.qid}`;

  return (
    <div className={`auth-question is-${result.status}`}>
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
              <span className={`chip chip-${result.status === "issue" ? "critical" : "low"}`}>
                {result.status === "issue" ? "Issue" : "Authenticated"}
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
        </div>
      )}
    </div>
  );
}

export default function AuthenticationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm } = useAssessment();

  const assignment = getAssignment(id);
  const form = assignment ? getForm(assignment) : null;

  const outcome = useMemo(
    () => (assignment && form ? authenticate(assignment.id, assignment.applicantId, form) : null),
    [assignment, form]
  );

  if (!assignment || !outcome) return <AssessmentNotFound />;

  const status = statusFor(id, outcome.isClean);
  const sections = Array.from(new Set(outcome.questions.map((q) => q.section)));

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Authentication result</h1>
          <p className="page-sub">
            Each answer is checked against the document attached to it. {departmentFor(assignment).name} ·{" "}
            {assignment.reference}
          </p>
        </div>
      </header>

      <OutcomeTabs assessmentId={id} active="authentication" scoringReady={status === "COMPLETED"} />

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
          <span className={`auth-stat-value${outcome.issues.length > 0 ? " is-critical" : ""}`}>
            {outcome.issues.length}
          </span>
        </div>
      </section>

      {outcome.issues.length > 0 ? (
        <div className="notice notice-critical">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>
              {outcome.issues.length} question{outcome.issues.length > 1 ? "s" : ""} could not be
              authenticated
            </strong>{" "}
            ({outcome.issues.map((q) => q.qid).join(", ")}). Scoring does not run until these are
            resolved.
          </div>
        </div>
      ) : (
        <div className="notice notice-good">
          <CheckCircleIcon size={17} />
          <div>
            <strong>Every answer was authenticated against its evidence.</strong> The submission
            passed to scoring.
          </div>
        </div>
      )}

      {sections.map((section) => {
        const questions = outcome.questions.filter((q) => q.section === section);
        const issueCount = questions.filter((q) => q.status === "issue").length;
        return (
          <section className="card section" key={section}>
            <div className="section-head section-head-static">
              <span className="section-title">{displaySection(section)}</span>
              {issueCount > 0 && (
                <span className="section-flag">
                  <AlertTriangleIcon size={12} />
                  {issueCount} issue{issueCount > 1 ? "s" : ""}
                </span>
              )}
              <span className="section-count">
                {questions.length} question{questions.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="section-body">
              {questions.map((q) => (
                <QuestionRow key={q.qid} result={q} />
              ))}
            </div>
          </section>
        );
      })}

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate(`/apply/${id}/status`)}>
          <ArrowLeftIcon size={15} />
          Back to status
        </button>
        {status === "AUTH_ISSUES" && (
          <button className="btn btn-primary" onClick={() => navigate(`/apply/${id}`)}>
            Correct the form
          </button>
        )}
      </footer>
    </div>
  );
}

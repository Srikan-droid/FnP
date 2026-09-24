import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate } from "../domain/authentication";
import { pipelineProgress, statusFor } from "../state/submissionStore";
import AssessmentNotFound from "../components/AssessmentNotFound";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "../components/icons";
import type { SubmissionStatus } from "../state/submissionStore";

const COPY: Record<
  Exclude<SubmissionStatus, "NOT_SUBMITTED">,
  { title: string; detail: string; tone: string }
> = {
  AUTH_PENDING: {
    title: "Authentication pending",
    detail:
      "Your documents are being read and checked against your answers. Nothing is scored until this finishes.",
    tone: "info",
  },
  SCORING: {
    title: "Authentication completed · scoring in progress",
    detail:
      "Every answer was authenticated against its evidence. The fit and proper score is being calculated now.",
    tone: "good",
  },
  AUTH_ISSUES: {
    title: "Authentication completed · issues found",
    detail:
      "One or more answers could not be authenticated against the evidence, so scoring did not run. Review the findings and resubmit.",
    tone: "critical",
  },
  COMPLETED: {
    title: "Completed",
    detail: "Authentication and scoring are both finished. Both reports are available below.",
    tone: "good",
  },
};

export default function StatusPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm } = useAssessment();
  const [now, setNow] = useState(() => Date.now());

  const assignment = getAssignment(id);
  const form = assignment ? getForm(assignment) : null;

  const outcome = useMemo(
    () => (assignment && form ? authenticate(assignment.id, assignment.applicantId, form) : null),
    [assignment, form]
  );

  const status = outcome ? statusFor(id, outcome.isClean, now) : "NOT_SUBMITTED";
  const settled = status === "COMPLETED" || status === "AUTH_ISSUES";

  useEffect(() => {
    if (settled) return;
    const tick = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(tick);
  }, [settled]);

  if (!assignment || !outcome) return <AssessmentNotFound />;

  if (status === "NOT_SUBMITTED") {
    return (
      <div className="page">
        <div className="card empty-state">
          <span className="empty-icon">
            <ShieldCheckIcon size={22} />
          </span>
          <h2>Nothing submitted yet</h2>
          <p>This assessment has not been submitted, so there is no status to report.</p>
          <button className="btn btn-primary" onClick={() => navigate(`/apply/${id}`)}>
            Go to the form
          </button>
        </div>
      </div>
    );
  }

  const copy = COPY[status];
  const progress = pipelineProgress(id, now) * 100;

  return (
    <div className="page page-narrow">
      <header className="page-head page-head-center">
        <div className="page-head-text">
          <h1>Submission status</h1>
          <p className="page-sub">
            {departmentFor(assignment).name} · {assignment.reference}
          </p>
        </div>
      </header>

      <section className={`card status-card status-${copy.tone}`}>
        <span className="status-icon">
          {status === "AUTH_PENDING" ? (
            <span className="status-spinner" />
          ) : status === "AUTH_ISSUES" ? (
            <AlertTriangleIcon size={22} />
          ) : (
            <CheckCircleIcon size={22} />
          )}
        </span>

        <h2 className="status-title">{copy.title}</h2>
        <p className="status-detail">{copy.detail}</p>

        {!settled && (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}

        <ol className="status-stages">
          <li className={status === "AUTH_PENDING" ? "is-active" : "is-done"}>
            <span className="stage-dot" />
            Authentication
          </li>
          <li
            className={
              status === "COMPLETED"
                ? "is-done"
                : status === "SCORING"
                  ? "is-active"
                  : status === "AUTH_ISSUES"
                    ? "is-blocked"
                    : "is-todo"
            }
          >
            <span className="stage-dot" />
            Scoring
          </li>
        </ol>

        <div className="status-actions">
          {status !== "AUTH_PENDING" && (
            <button
              className={`btn ${status === "COMPLETED" ? "btn-ghost" : "btn-primary"}`}
              onClick={() => navigate(`/apply/${id}/authentication`)}
            >
              View authentication result
              <ArrowRightIcon size={15} />
            </button>
          )}
          {status === "COMPLETED" && (
            <button className="btn btn-primary" onClick={() => navigate(`/apply/${id}/result`)}>
              View score
              <ArrowRightIcon size={15} />
            </button>
          )}
          {status === "AUTH_ISSUES" && (
            <button className="btn btn-ghost" onClick={() => navigate(`/apply/${id}`)}>
              <ArrowLeftIcon size={15} />
              Back to the form
            </button>
          )}
        </div>
      </section>

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate("/assessments")}>
          <ArrowLeftIcon size={15} />
          Back to your assessments
        </button>
      </footer>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate } from "../domain/authentication";
import { isScored, stageFor, stageProgress } from "../state/caseStore";
import { flaggedQids } from "../domain/reviewState";
import AssessmentNotFound from "../components/AssessmentNotFound";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "../components/icons";
import type { CaseStage } from "../state/caseStore";

const COPY: Record<
  Exclude<CaseStage, "NOT_SUBMITTED">,
  { title: string; detail: string; tone: string }
> = {
  AUTH_RUNNING: {
    title: "Authentication pending",
    detail:
      "Your documents are being read and checked against your answers. Nothing is scored until this finishes.",
    tone: "info",
  },
  REVIEW_PENDING: {
    title: "Authentication completed · with the reviewer",
    detail:
      "One or more answers could not be authenticated against the evidence, so the assessment has gone to a reviewer. You can act once they have accepted or rejected those answers.",
    tone: "info",
  },
  AWAITING_APPLICANT: {
    title: "Action needed · evidence rejected",
    detail:
      "The reviewer did not accept the evidence behind one or more answers. Attach the documents they asked for and resubmit; the assessment then goes back for authentication.",
    tone: "critical",
  },
  SCORING: {
    title: "Authentication completed · scoring in progress",
    detail: "Every answer is authenticated. The fit and proper score is being calculated now.",
    tone: "good",
  },
  DECISION_PENDING: {
    title: "Scored · with the reviewer for a decision",
    detail:
      "Authentication and scoring are both finished. The reviewer is considering the outcome; both reports are available below.",
    tone: "good",
  },
  ACCEPTED: {
    title: "Accepted",
    detail: "The reviewer accepted this assessment. Both reports are available below.",
    tone: "good",
  },
  REJECTED: {
    title: "Rejected",
    detail: "The reviewer rejected this assessment. Both reports are available below.",
    tone: "critical",
  },
};

function reviewStageClass(status: CaseStage): string {
  if (status === "AUTH_RUNNING") return "is-todo";
  if (status === "REVIEW_PENDING") return "is-active";
  if (status === "AWAITING_APPLICANT") return "is-blocked";
  return "is-done";
}

function scoringStageClass(status: CaseStage): string {
  if (status === "SCORING") return "is-active";
  if (status === "AWAITING_APPLICANT") return "is-blocked";
  return isScored(status) ? "is-done" : "is-todo";
}
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

  const flagged = useMemo(() => (outcome ? flaggedQids(outcome) : []), [outcome]);
  const status: CaseStage = outcome ? stageFor(id, flagged, now) : "NOT_SUBMITTED";
  const settled = status !== "AUTH_RUNNING" && status !== "SCORING";

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
  const progress = stageProgress(id, flagged, now) * 100;

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
          {status === "AUTH_RUNNING" || status === "SCORING" ? (
            <span className="status-spinner" />
          ) : status === "AWAITING_APPLICANT" || status === "REJECTED" ? (
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
          <li className={status === "AUTH_RUNNING" ? "is-active" : "is-done"}>
            <span className="stage-dot" />
            Authentication
          </li>
          <li className={reviewStageClass(status)}>
            <span className="stage-dot" />
            Reviewer
          </li>
          <li className={scoringStageClass(status)}>
            <span className="stage-dot" />
            Scoring
          </li>
        </ol>

        <div className="status-actions">
          {status !== "AUTH_RUNNING" && (
            <button
              className={`btn ${isScored(status) ? "btn-ghost" : "btn-primary"}`}
              onClick={() => navigate(`/apply/${id}/authentication`)}
            >
              {status === "AWAITING_APPLICANT"
                ? "Review and resubmit evidence"
                : "View authentication result"}
              <ArrowRightIcon size={15} />
            </button>
          )}
          {isScored(status) && (
            <button className="btn btn-primary" onClick={() => navigate(`/apply/${id}/result`)}>
              View score
              <ArrowRightIcon size={15} />
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

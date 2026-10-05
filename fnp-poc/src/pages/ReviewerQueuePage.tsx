import { useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { REVIEWABLE_ASSIGNMENTS, departmentFor, formatDate } from "../data/assignments";
import { authenticate } from "../domain/authentication";
import { flaggedQids, unresolvedFlags } from "../domain/reviewState";
import { anyCaseInFlight, readCase, stageFor } from "../state/caseStore";
import { useStageTicker } from "../state/useStageTicker";
import { STAGE_LABELS, needsReviewer, queueRank } from "../domain/caseLabels";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BankIcon,
  CheckCircleIcon,
  SlidersIcon,
} from "../components/icons";
import type { Assignment } from "../data/assignments";
import type { CaseStage } from "../state/caseStore";

interface QueueRow {
  assignment: Assignment;
  stage: CaseStage;
  openFlags: number;
  flaggedQids: string[];
}

export default function ReviewerQueuePage() {
  const navigate = useNavigate();
  const { role, getForm } = useAssessment();
  // Derived straight from the stored timestamps, so the clock stops on the render where the
  // last case settles without routing the flag through state.
  const now = useStageTicker(anyCaseInFlight(REVIEWABLE_ASSIGNMENTS.map((a) => a.id)));

  const rows = useMemo<QueueRow[]>(() => {
    const built = REVIEWABLE_ASSIGNMENTS.map((assignment) => {
      const form = getForm(assignment);
      const outcome = authenticate(assignment.id, assignment.applicantId, form);
      const flagged = flaggedQids(outcome);
      return {
        assignment,
        stage: stageFor(assignment.id, flagged, now),
        openFlags: unresolvedFlags(assignment.id, outcome).length,
        flaggedQids: flagged,
      };
    });
    return built.sort(
      (a, b) =>
        queueRank(a.stage) - queueRank(b.stage) ||
        a.assignment.applicantName.localeCompare(b.assignment.applicantName)
    );
  }, [getForm, now]);


  if (role !== "reviewer") return <Navigate to="/assessments" replace />;

  const actionable = rows.filter((r) => needsReviewer(r.stage)).length;

  const openCase = (row: QueueRow) => {
    const target = row.stage === "DECISION_PENDING" ? "result" : "authentication";
    navigate(`/reviewer/${row.assignment.id}/${target}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Assessment queue</h1>
          <p className="page-sub">
            {rows.length} fit and proper assessment{rows.length === 1 ? "" : "s"} for Banking
            Licence.{" "}
            {actionable > 0
              ? `${actionable} need${actionable === 1 ? "s" : ""} your attention.`
              : "Nothing is waiting on you."}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate("/reviewer/questions")}>
          <SlidersIcon size={15} />
          Configure questions
        </button>
      </header>

      <div className="case-grid">
        {rows.map((row) => {
          const { assignment, stage } = row;
          const label = STAGE_LABELS[stage];
          return (
            <button className="case-card" key={assignment.id} onClick={() => openCase(row)}>
              <div className="case-card-head">
                <span className="case-avatar">
                  <BankIcon size={16} />
                </span>
                <span className={`chip chip-${label.tone}`}>
                  {needsReviewer(stage) && <AlertTriangleIcon size={12} />}
                  {stage === "ACCEPTED" && <CheckCircleIcon size={12} />}
                  {label.reviewer}
                </span>
              </div>

              <h2 className="case-name">{assignment.applicantName}</h2>
              <p className="case-role">
                {assignment.position} · {assignment.entity}
              </p>

              <dl className="case-meta">
                <div>
                  <dt>Reference</dt>
                  <dd>{assignment.reference}</dd>
                </div>
                <div>
                  <dt>Initiated</dt>
                  <dd>{formatDate(assignment.initiatedOn)}</dd>
                </div>
                <div>
                  <dt>Department</dt>
                  <dd>{departmentFor(assignment).name}</dd>
                </div>
              </dl>

              <footer className="case-foot">
                <CaseFootNote row={row} />
                <span className="case-open">
                  {stage === "DECISION_PENDING" ? "Decide" : "Open"}
                  <ArrowRightIcon size={14} />
                </span>
              </footer>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CaseFootNote({ row }: { row: QueueRow }) {
  const record = readCase(row.assignment.id);

  if (row.stage === "REVIEW_PENDING") {
    return (
      <span className="case-note is-critical">
        {row.openFlags} question{row.openFlags === 1 ? "" : "s"} to rule on
        {row.flaggedQids.length > 0 && ` (${row.flaggedQids.join(", ")})`}
      </span>
    );
  }
  if (row.stage === "AWAITING_APPLICANT") {
    const rejected = Object.entries(record.rulings)
      .filter(([, r]) => r.verdict === "rejected")
      .map(([qid]) => qid);
    return <span className="case-note">Rejected {rejected.join(", ")} — waiting on new evidence</span>;
  }
  if (row.stage === "DECISION_PENDING") {
    return <span className="case-note">Scored — accept or reject</span>;
  }
  if (record.decision) {
    return <span className="case-note">{record.decision.remarks.slice(0, 90)}</span>;
  }
  return <span className="case-note">No action needed</span>;
}

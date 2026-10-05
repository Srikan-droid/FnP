import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate } from "../domain/authentication";
import { score } from "../domain/engine";
import { flaggedQids, unresolvedFlags } from "../domain/reviewState";
import { isScored, readCase, recordDecision, stageFor } from "../state/caseStore";
import { STAGE_LABELS } from "../domain/caseLabels";
import { finalAssessmentFor } from "../domain/finalAssessment";
import AssessmentNotFound from "../components/AssessmentNotFound";
import ReportView from "../components/ReportView";
import AssessmentSummaryPane from "../components/AssessmentSummaryPane";
import DecisionDialog from "../components/DecisionDialog";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  FileTextIcon,
  MessageIcon,
} from "../components/icons";
import type { RulingVerdict } from "../state/caseStore";

export default function ReviewerResultPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { role, getForm } = useAssessment();
  const [pending, setPending] = useState<RulingVerdict | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  const assignment = getAssignment(id);
  const form = assignment ? getForm(assignment) : null;

  const outcome = useMemo(
    () => (assignment && form ? authenticate(assignment.id, assignment.applicantId, form) : null),
    [assignment, form]
  );

  const scoreResult = useMemo(() => {
    if (!outcome || !form) return null;
    if (unresolvedFlags(id, outcome).length > 0) return null;
    // Scored against the weights in force when it was submitted, not whatever the
    // reviewer has configured since.
    return score(form, readCase(id).weightSnapshot);
  }, [id, outcome, form]);

  if (role !== "reviewer") return <Navigate to="/assessments" replace />;
  if (!assignment || !form || !outcome) return <AssessmentNotFound />;

  const stage = stageFor(id, flaggedQids(outcome));
  if (!isScored(stage) || !scoreResult) {
    return <Navigate to={`/reviewer/${id}/authentication`} replace />;
  }

  const record = readCase(id);
  const label = STAGE_LABELS[stage];

  const confirm = (remarks: string) => {
    if (!pending) return;
    recordDecision(id, pending, remarks);
    setPending(null);
    setRevision((v) => v + 1);
  };

  return (
    <div className="page" key={revision}>
      <header className="page-head">
        <div className="page-head-text">
          <h1>{assignment.applicantName}</h1>
          <p className="page-sub">
            {assignment.position} · {departmentFor(assignment).name} · {assignment.reference}
          </p>
        </div>
        <div className="page-head-aside">
          <span className={`chip chip-${label.tone}`}>{label.reviewer}</span>
        </div>
      </header>

      <nav className="reviewer-tabs">
        <button onClick={() => navigate(`/reviewer/${id}/authentication`)}>Authentication</button>
        <span className="is-active">Scoring and decision</span>
      </nav>

      {record.decision ? (
        <div
          className={`notice notice-${record.decision.verdict === "accepted" ? "good" : "critical"}`}
        >
          {record.decision.verdict === "accepted" ? (
            <CheckCircleIcon size={17} />
          ) : (
            <AlertTriangleIcon size={17} />
          )}
          <div>
            <strong>
              {record.decision.verdict === "accepted"
                ? "You accepted this assessment."
                : "You rejected this assessment."}
            </strong>{" "}
            {record.decision.remarks}
          </div>
        </div>
      ) : (
        <div className="notice notice-info">
          <MessageIcon size={17} />
          <div>
            <strong>This assessment is scored and waiting on your decision.</strong> Accept or
            reject it below; your remarks are recorded on the case and shown to the applicant.
          </div>
        </div>
      )}

      <ReportView authentication={outcome} scoreResult={scoreResult} />

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate("/reviewer")}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
        <button className="btn btn-ghost" onClick={() => setSummaryOpen(true)}>
          <FileTextIcon size={15} />
          Assessment summary
        </button>
        {!record.decision && (
          <>
            <button className="btn btn-ghost" onClick={() => setPending("rejected")}>
              <AlertTriangleIcon size={15} />
              Reject
            </button>
            <button className="btn btn-primary" onClick={() => setPending("accepted")}>
              <CheckCircleIcon size={15} />
              Accept
            </button>
          </>
        )}
      </footer>

      {summaryOpen && (
        <AssessmentSummaryPane
          assessment={finalAssessmentFor(assignment.applicantId)}
          applicantName={assignment.applicantName}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {pending && (
        <DecisionDialog
          verdict={pending}
          applicantName={assignment.applicantName}
          band={scoreResult.band}
          riskScore={scoreResult.riskScore100}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

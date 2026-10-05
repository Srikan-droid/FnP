import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate } from "../domain/authentication";
import { score } from "../domain/engine";
import { isScored, readCase, stageFor } from "../state/caseStore";
import { flaggedQids, unresolvedFlags } from "../domain/reviewState";
import ReportView from "../components/ReportView";
import OutcomeTabs from "../components/OutcomeTabs";
import AssessmentNotFound from "../components/AssessmentNotFound";
import AssessmentSummaryPane from "../components/AssessmentSummaryPane";
import { finalAssessmentFor } from "../domain/finalAssessment";
import { ArrowLeftIcon, FileTextIcon } from "../components/icons";

export default function ResultPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm } = useAssessment();
  const [summaryOpen, setSummaryOpen] = useState(false);

  const assignment = getAssignment(id);
  const form = assignment ? getForm(assignment) : null;

  const outcome = useMemo(
    () => (assignment && form ? authenticate(assignment.id, assignment.applicantId, form) : null),
    [assignment, form]
  );
  // A flag the reviewer has overridden no longer blocks scoring, so the gate is "nothing
  // unresolved" rather than "the engine found nothing".
  const scoreResult = useMemo(() => {
    if (!outcome || !form) return null;
    if (unresolvedFlags(id, outcome).length > 0) return null;
    // Scored against the weights in force when it was submitted, not whatever the
    // reviewer has configured since.
    return score(form, readCase(id).weightSnapshot);
  }, [id, outcome, form]);

  if (!assignment || !form || !outcome) return <AssessmentNotFound />;

  // Scoring only exists once authentication has cleared and the engine has finished.
  const stage = stageFor(id, flaggedQids(outcome));
  if (!isScored(stage) || !scoreResult) {
    return <Navigate to={`/apply/${id}/status`} replace />;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Scoring result</h1>
          <p className="page-sub">
            Weighted against authenticated answers only. {departmentFor(assignment).name} ·{" "}
            {assignment.reference}
          </p>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Entity</dt>
            <dd>{assignment.entity}</dd>
          </div>
          <div>
            <dt>Position applied for</dt>
            <dd>{assignment.position}</dd>
          </div>
        </dl>
      </header>

      <OutcomeTabs assessmentId={id} active="scoring" scoringReady />

      <ReportView authentication={outcome} scoreResult={scoreResult} />

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate("/assessments")}>
          <ArrowLeftIcon size={15} />
          Back to your assessments
        </button>
        <button className="btn btn-primary" onClick={() => setSummaryOpen(true)}>
          <FileTextIcon size={15} />
          Assessment summary
        </button>
      </footer>

      {summaryOpen && (
        <AssessmentSummaryPane
          assessment={finalAssessmentFor(assignment.applicantId)}
          applicantName={assignment.applicantName}
          onClose={() => setSummaryOpen(false)}
        />
      )}
    </div>
  );
}

import { useMemo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate } from "../domain/authentication";
import { score } from "../domain/engine";
import { statusFor } from "../state/submissionStore";
import ReportView from "../components/ReportView";
import OutcomeTabs from "../components/OutcomeTabs";
import AssessmentNotFound from "../components/AssessmentNotFound";
import { ArrowLeftIcon } from "../components/icons";

export default function ResultPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm } = useAssessment();

  const assignment = getAssignment(id);
  const form = assignment ? getForm(assignment) : null;

  const outcome = useMemo(
    () => (assignment && form ? authenticate(assignment.id, assignment.applicantId, form) : null),
    [assignment, form]
  );
  const scoreResult = useMemo(
    () => (outcome?.isClean && form ? score(form) : null),
    [outcome, form]
  );

  if (!assignment || !form || !outcome) return <AssessmentNotFound />;

  // Scoring only exists once authentication has cleared and the engine has finished.
  const status = statusFor(id, outcome.isClean);
  if (status !== "COMPLETED" || !scoreResult) {
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

      <ReportView form={form} authentication={outcome} scoreResult={scoreResult} />

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate("/assessments")}>
          <ArrowLeftIcon size={15} />
          Back to your assessments
        </button>
      </footer>
    </div>
  );
}

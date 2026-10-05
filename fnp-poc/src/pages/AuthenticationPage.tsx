import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate, issuesIn } from "../domain/authentication";
import { flaggedQids, rejectedFlags } from "../domain/reviewState";
import { isScored, recordResubmission, stageFor } from "../state/caseStore";
import { CV_QID, fileNameFor, findOption } from "../domain/evidenceOptions";
import AssessmentNotFound from "../components/AssessmentNotFound";
import OutcomeTabs from "../components/OutcomeTabs";
import AuthenticationReport from "../components/AuthenticationReport";
import EvidenceBlock from "../components/EvidenceBlock";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  MessageIcon,
} from "../components/icons";
import type { EvidenceRole, QuestionAuthResult } from "../domain/types";

export default function AuthenticationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm, attachEvidence, removeEvidence } = useAssessment();
  const [resubmitted, setResubmitted] = useState(false);

  const assignment = getAssignment(id);
  const form = assignment ? getForm(assignment) : null;

  const outcome = useMemo(
    () => (assignment && form ? authenticate(assignment.id, assignment.applicantId, form) : null),
    [assignment, form]
  );

  if (!assignment || !form || !outcome) return <AssessmentNotFound />;

  const flagged = flaggedQids(outcome);
  const stage = stageFor(id, flagged);
  const rejected = rejectedFlags(id, outcome);
  const issues = issuesIn(outcome);
  // Only a rejection puts the ball back in the applicant's court.
  const mustResubmit = stage === "AWAITING_APPLICANT";
  const rejectedQids = new Set(rejected.map((r) => r.result.qid));

  const handleAttach = (qid: string, optionCode: string, role: EvidenceRole, description?: string) => {
    const option = findOption(qid, optionCode);
    if (!option) return;
    attachEvidence(assignment, qid, {
      doc_type: option.docType,
      path: `evidence/${assignment.applicantId}/${fileNameFor(option)}`,
      role,
      option_code: option.code,
      description,
    });
  };

  const resubmit = () => {
    recordResubmission(id);
    setResubmitted(true);
    navigate(`/apply/${id}/status`);
  };

  const questionFooter = (result: QuestionAuthResult) => {
    if (!mustResubmit || !rejectedQids.has(result.qid)) return null;
    const ruling = rejected.find((r) => r.result.qid === result.qid)?.ruling;
    const response = form.responses.find((r) => r.qid === result.qid);

    return (
      <div className="resubmit-block">
        {ruling && (
          <div className="reviewer-note">
            <MessageIcon size={14} />
            <div>
              <span className="reviewer-note-label">Reviewer</span>
              <p>{ruling.comment}</p>
            </div>
          </div>
        )}
        {response && result.qid !== CV_QID && (
          <EvidenceBlock
            qid={result.qid}
            evidence={response.evidence}
            onAttach={(code, role, description) => handleAttach(result.qid, code, role, description)}
            onRemove={(docType) => removeEvidence(assignment, result.qid, docType)}
          />
        )}
      </div>
    );
  };

  const notice = mustResubmit ? (
    <div className="notice notice-warning">
      <AlertTriangleIcon size={17} />
      <div>
        <strong>
          The reviewer rejected {rejected.length} answer{rejected.length > 1 ? "s" : ""}
        </strong>{" "}
        ({rejected.map((r) => r.result.qid).join(", ")}). Attach the evidence they asked for below,
        then resubmit. The assessment goes back for authentication.
      </div>
    </div>
  ) : issues.length > 0 ? (
    <div className="notice notice-critical">
      <AlertTriangleIcon size={17} />
      <div>
        <strong>
          {issues.length} question{issues.length > 1 ? "s" : ""} could not be authenticated
        </strong>{" "}
        ({issues.map((q) => q.qid).join(", ")}).{" "}
        {stage === "REVIEW_PENDING"
          ? "A reviewer is looking at these now. You will be told if any answer needs new evidence."
          : "Scoring does not run until these are resolved."}
      </div>
    </div>
  ) : (
    <div className="notice notice-good">
      <CheckCircleIcon size={17} />
      <div>
        <strong>Every answer was authenticated against its evidence.</strong> The submission passed
        to scoring.
      </div>
    </div>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Authentication result</h1>
          <p className="page-sub">
            Each answer is checked against the document attached to it.{" "}
            {departmentFor(assignment).name} · {assignment.reference}
          </p>
        </div>
      </header>

      <OutcomeTabs assessmentId={id} active="authentication" scoringReady={isScored(stage)} />

      <AuthenticationReport
        assessmentId={id}
        outcome={outcome}
        notice={notice}
        questionFooter={questionFooter}
      />

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate(`/apply/${id}/status`)}>
          <ArrowLeftIcon size={15} />
          Back to status
        </button>
        {mustResubmit && (
          <button className="btn btn-primary" disabled={resubmitted} onClick={resubmit}>
            Resubmit for authentication
            <ArrowRightIcon size={15} />
          </button>
        )}
      </footer>
    </div>
  );
}

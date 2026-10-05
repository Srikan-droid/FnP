import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { authenticate, issuesIn } from "../domain/authentication";
import { flaggedQids, unresolvedFlags } from "../domain/reviewState";
import {
  anyCaseInFlight,
  clearRuling,
  isScored,
  readCase,
  ruleOnQuestion,
  stageFor,
} from "../state/caseStore";
import { STAGE_LABELS } from "../domain/caseLabels";
import { useStageTicker } from "../state/useStageTicker";
import AssessmentNotFound from "../components/AssessmentNotFound";
import AuthenticationReport from "../components/AuthenticationReport";
import OverrideDialog from "../components/OverrideDialog";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  MessageIcon,
} from "../components/icons";
import type { RulingVerdict } from "../state/caseStore";
import type { QuestionAuthResult } from "../domain/types";

interface Pending {
  result: QuestionAuthResult;
  verdict: RulingVerdict;
}

export default function ReviewerAuthenticationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { role, getForm } = useAssessment();
  const [pending, setPending] = useState<Pending | null>(null);
  // Bumped after each ruling so the page re-reads the case from storage.
  const [revision, setRevision] = useState(0);

  const assignment = getAssignment(id);
  const form = assignment ? getForm(assignment) : null;

  const outcome = useMemo(
    () => (assignment && form ? authenticate(assignment.id, assignment.applicantId, form) : null),
    [assignment, form]
  );

  // Every hook runs before the guards below, so a redirect can never change the hook order.
  const flagged = useMemo(() => (outcome ? flaggedQids(outcome) : []), [outcome]);
  const now = useStageTicker(anyCaseInFlight([id]));
  const liveStage = outcome ? stageFor(id, flagged, now) : "NOT_SUBMITTED";

  if (role !== "reviewer") return <Navigate to="/assessments" replace />;
  if (!assignment || !form || !outcome) return <AssessmentNotFound />;

  const record = readCase(id);
  const stage = liveStage;
  const open = unresolvedFlags(id, outcome);
  const issues = issuesIn(outcome);
  const label = STAGE_LABELS[stage];
  const canRule = stage === "REVIEW_PENDING";

  const confirm = (comment: string) => {
    if (!pending) return;
    ruleOnQuestion(id, pending.result.qid, pending.verdict, comment);
    setPending(null);
    setRevision((v) => v + 1);
  };

  const undo = (qid: string) => {
    clearRuling(id, qid);
    setRevision((v) => v + 1);
  };

  const questionFooter = (result: QuestionAuthResult) => {
    if (result.status !== "issue") return null;
    const ruling = record.rulings[result.qid];

    if (ruling) {
      return (
        <div className="ruling-block" key={`${result.qid}-${revision}`}>
          <div className={`reviewer-note is-${ruling.verdict}`}>
            <MessageIcon size={14} />
            <div>
              <span className="reviewer-note-label">
                {ruling.verdict === "accepted"
                  ? "Accepted — AI finding overridden"
                  : "Rejected — returned to the applicant"}
              </span>
              <p>{ruling.comment}</p>
            </div>
          </div>
          {stage === "REVIEW_PENDING" && (
            <button className="btn btn-ghost btn-sm" onClick={() => undo(result.qid)}>
              Undo this ruling
            </button>
          )}
        </div>
      );
    }

    if (!canRule) return null;

    return (
      <div className="ruling-actions">
        <p className="ruling-prompt">
          The engine could not authenticate this answer. Accept it on your own judgment, or reject
          it and ask the applicant for new evidence.
        </p>
        <div className="ruling-buttons">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setPending({ result, verdict: "accepted" })}
          >
            <CheckCircleIcon size={14} />
            Accept with comment
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPending({ result, verdict: "rejected" })}
          >
            <AlertTriangleIcon size={14} />
            Reject and return
          </button>
        </div>
      </div>
    );
  };

  const notice =
    issues.length === 0 ? (
      <div className="notice notice-good">
        <CheckCircleIcon size={17} />
        <div>
          <strong>Every answer was authenticated against its evidence.</strong> Nothing needs your
          judgment at this stage.
        </div>
      </div>
    ) : open.length > 0 ? (
      <div className="notice notice-critical">
        <AlertTriangleIcon size={17} />
        <div>
          <strong>
            {open.length} question{open.length > 1 ? "s" : ""} awaiting your ruling
          </strong>{" "}
          ({open.map((f) => f.result.qid).join(", ")}). The assessment moves to scoring once every
          flagged answer is accepted.
        </div>
      </div>
    ) : (
      <div className="notice notice-info">
        <CheckCircleIcon size={17} />
        <div>
          <strong>All flagged answers have been ruled on.</strong>{" "}
          {stage === "AWAITING_APPLICANT"
            ? "The applicant has been asked for new evidence."
            : "The assessment has moved on to scoring."}
        </div>
      </div>
    );

  return (
    <div className="page">
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
        <span className="is-active">Authentication</span>
        <button
          disabled={!isScored(stage)}
          onClick={() => navigate(`/reviewer/${id}/result`)}
          title={isScored(stage) ? undefined : "Available once scoring has finished"}
        >
          Scoring and decision
        </button>
      </nav>

      <AuthenticationReport
        assessmentId={id}
        outcome={outcome}
        notice={notice}
        questionFooter={questionFooter}
      />

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate("/reviewer")}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
        {isScored(stage) && (
          <button className="btn btn-primary" onClick={() => navigate(`/reviewer/${id}/result`)}>
            Go to scoring and decision
            <ArrowRightIcon size={15} />
          </button>
        )}
      </footer>

      {pending && (
        <OverrideDialog
          qid={pending.result.qid}
          question={pending.result.question}
          verdict={pending.verdict}
          failingChecks={pending.result.checks
            .filter((c) => c.status === "fail")
            .map((c) => `${c.label} — ${c.note}`)}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

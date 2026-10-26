import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useDecide, useForceScore, useSession } from "../api/queries";
import { refusalMessage } from "../api/client";
import { useCaseView } from "../api/useCaseView";
import CaseReviewerBar from "../components/CaseReviewerBar";
import { heldByOther } from "../state/access";
import { isScored } from "../state/caseLabels";
import { routes } from "../routes";
import { queueUrl } from "../state/queueReturn";
import { Loading, LoadError } from "../components/LoadState";
import ReportView from "../components/ReportView";
import EmptyState from "../components/EmptyState";
import AssessmentSummaryPane from "../components/AssessmentSummaryPane";
import DecisionDialog from "../components/DecisionDialog";
import ReviewerTabs from "../components/ReviewerTabs";
import { ReviewerCaseHeader } from "../components/PageHeader";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  FileTextIcon,
  InfoIcon,
  MessageIcon,
} from "../components/icons";
import type { Verdict } from "../api/types";

export default function ReviewerResultPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Verdict | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Bumped after the decision; keying the page on it re-renders the report from scratch.
  const [revision, setRevision] = useState(0);
  const view = useCaseView(id);
  const decide = useDecide(id);
  const forceScore = useForceScore(id);
  const me = useSession().data;

  if (view.status === "loading") return <Loading />;
  if (view.status === "error") return <LoadError error={view.error} onRetry={view.retry} />;
  const { assessment: assignment, data, outcome, score: scoreResult } = view;
  const stage = data.stage;
  // Another admin is reviewing it: this one reads it (the server refuses their steps too).
  const othersCase = heldByOther(data.reviewer, me);
  // Sent on to scoring: the engine is working; this page refreshes until the score is in.
  if (stage === "SCORING") {
    return (
      <div className="page">
        <ReviewerCaseHeader assignment={assignment} stage={stage} />
        <ReviewerTabs assessmentId={id} active="scoring" scoringReady />
        <CaseReviewerBar id={id} assignment={assignment} data={data} />
        <EmptyState
          icon={<InfoIcon size={22} />}
          title="Scoring in progress"
          action={
            data.run?.canForceScore && !assignment.ownApplication && !othersCase ? (
              <button className="btn btn-primary" disabled={forceScore.isPending} onClick={() => forceScore.mutate(undefined)}>
                {forceScore.isPending ? "Sending…" : "Send it to the AI engine again"}
              </button>
            ) : undefined
          }
        >
          {data.run?.scoreForced
            ? "You accepted every flagged answer, so the AI engine is scoring the assessment and writing its summary."
            : "The AI engine is scoring the assessment and writing its summary."}{" "}
          This page updates by itself once it is done; it usually takes under a minute.
          {forceScore.isError && (
            <>
              {" "}
              <strong>Not sent.</strong> {refusalMessage(forceScore.error, "detail")}
            </>
          )}
        </EmptyState>
        <footer className="actionbar">
          <button className="btn btn-ghost" onClick={() => navigate(queueUrl())}>
            <ArrowLeftIcon size={15} />
            Back to the queue
          </button>
        </footer>
      </div>
    );
  }
  // Open once the case is waiting on (or has) a decision. It may have no score: the AI engine
  // scores only a submission in which every answer was authenticated.
  if (!isScored(stage) || !outcome) {
    // A cached copy can predate the decision stage; only a fresh one decides it is not ready.
    if (view.refreshing) return <Loading />;
    return <Navigate to={routes.reviewerAuthentication(id)} replace />;
  }

  const decision = data.decision;
  // A reviewer never decides their own application (the server refuses it too).
  const ownApplication = assignment.ownApplication;
  // Only the admin reviewing the case decides it.
  const blocked = ownApplication || othersCase;
  // Who decided it, as the decision records it: "You" when it was this admin.
  const decidedBy = decision?.by && decision.by !== me?.email ? decision.by : "You";

  const confirm = (remarks: string) => {
    if (!pending) return;
    decide.mutate(
      { verdict: pending, remarks },
      {
        // Kept open on a refusal, which the dialog explains, so the remarks are not lost.
        onSuccess: () => {
          setPending(null);
          setRevision((v) => v + 1);
        },
      }
    );
  };

  return (
    <div className="page" key={revision}>
      <ReviewerCaseHeader assignment={assignment} stage={stage} />

      <ReviewerTabs assessmentId={id} active="scoring" scoringReady />

      <CaseReviewerBar id={id} assignment={assignment} data={data} />

      {decision ? (
        <div
          className={`notice notice-${decision.verdict === "accepted" ? "good" : "critical"}`}
        >
          {decision.verdict === "accepted" ? (
            <CheckCircleIcon size={17} />
          ) : (
            <AlertTriangleIcon size={17} />
          )}
          <div>
            <strong>
              {decision.verdict === "accepted"
                ? `${decidedBy} accepted this assessment.`
                : `${decidedBy} rejected this assessment.`}
            </strong>{" "}
            Feedback: {decision.remarks}
          </div>
        </div>
      ) : ownApplication ? (
        <div className="notice notice-warning">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>This is your own application.</strong> Another reviewer must accept or reject
            it.
          </div>
        </div>
      ) : othersCase ? null : (
        <div className="notice notice-info">
          <MessageIcon size={17} />
          <div>
            <strong>
              {scoreResult
                ? "This assessment is scored and waiting on your decision."
                : "This assessment is waiting on your decision."}
            </strong>{" "}
            Accept or reject it below; your feedback is recorded on the case, shown to the
            applicant and included in the assessment summary.
          </div>
        </div>
      )}

      {scoreResult && data.run?.scoreForced && (
        <div className="notice notice-info">
          <InfoIcon size={17} />
          <div>
            <strong>Scored at your request.</strong> The AI engine flagged{" "}
            {data.flags.length > 0 ? data.flags.join(", ") : "answers"}, which you accepted, so it
            scored the assessment as if they were authenticated.
          </div>
        </div>
      )}

      {data.score?.source === "backend_override" && (
        <div className="notice notice-info">
          <InfoIcon size={17} />
          <div>
            <strong>Scored by the app's own rules.</strong> This score was calculated by the app, not
            the AI engine, before only AI-engine scores were used.{" "}
            {decision
              ? "It is shown because the decision was made on it."
              : data.run?.canForceScore
                ? "Request an AI score to replace it, or decide on it as it stands."
                : "Decide on it as it stands."}
            {!decision && data.run?.canForceScore && !blocked && (
              <div className="notice-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={forceScore.isPending}
                  onClick={() => forceScore.mutate(undefined)}
                >
                  {forceScore.isPending ? "Sending…" : "Request AI score"}
                </button>
                {forceScore.isError && (
                  <span className="field-error">{refusalMessage(forceScore.error, "detail")}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {scoreResult ? (
        <ReportView
          authentication={outcome}
          scoreResult={scoreResult}
          concerns={data.assessment?.concerns}
          reviews={data.reviewHistory}
        />
      ) : (
        <EmptyState
          icon={<InfoIcon size={22} />}
          title="Not scored by the AI engine"
          action={
            <div className="empty-actions">
              {data.run?.canForceScore && !decision && !blocked && (
                <button
                  className="btn btn-primary"
                  disabled={forceScore.isPending}
                  onClick={() => forceScore.mutate(undefined)}
                >
                  {forceScore.isPending
                    ? "Sending…"
                    : data.run.forceScoreError
                      ? "Try AI scoring again"
                      : "Request AI score"}
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => navigate(routes.reviewerAuthentication(id))}>
                View the authentication report
              </button>
            </div>
          }
        >
          The AI engine scores only a submission in which every answer was authenticated, unless
          you accept the answers it flagged and ask it to score anyway. This one has no risk score
          or band yet.
          {data.run?.forceScoreError && (
            <>
              {" "}
              <strong>The AI engine could not score it:</strong> {data.run.forceScoreError}
            </>
          )}
          {forceScore.isError && (
            <>
              {" "}
              <strong>Not sent.</strong> {refusalMessage(forceScore.error, "detail")}
            </>
          )}{" "}
          You can also decide on the authentication report.
        </EmptyState>
      )}


      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate(queueUrl())}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
        <button className="btn btn-ghost" onClick={() => setSummaryOpen(true)}>
          <FileTextIcon size={15} />
          Assessment summary
        </button>
        {!decision && !blocked && (
          <>
            <button className="btn btn-ghost" onClick={() => {
                decide.reset();
                setPending("rejected");
              }}>
              <AlertTriangleIcon size={15} />
              Reject
            </button>
            <button className="btn btn-primary" onClick={() => {
                decide.reset();
                setPending("accepted");
              }}>
              <CheckCircleIcon size={15} />
              Accept
            </button>
          </>
        )}
      </footer>

      {summaryOpen && (
        <AssessmentSummaryPane
          assessment={data.assessment}
          assignment={assignment}
          decision={decision}
          scoreResult={scoreResult}
          reviews={data.reviewHistory}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {pending && (
        <DecisionDialog
          verdict={pending}
          applicantName={assignment.applicantName}
          band={scoreResult?.band}
          riskScore={scoreResult?.riskScore100}
          busy={decide.isPending}
          error={decide.isError ? refusalMessage(decide.error, "remarks") : undefined}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

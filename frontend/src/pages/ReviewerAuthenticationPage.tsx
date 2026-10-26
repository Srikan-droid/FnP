import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useCatalogue,
  useCompleteReview,
  useForm,
  useRemoveAssessment,
  useRetry,
  useRule,
  useSession,
  useUndoRuling,
} from "../api/queries";
import { refusalMessage } from "../api/client";
import { useCaseView } from "../api/useCaseView";
import CaseReviewerBar from "../components/CaseReviewerBar";
import { heldByOther } from "../state/access";
import {
  questionsWithIssues,
  reviewStateFor,
  toApplicationForm,
  unresolvedFlags,
} from "../api/adapt";
import { withFormOptions } from "../domain/catalogue";
import { isScored } from "../state/caseLabels";
import { routes } from "../routes";
import { queueUrl } from "../state/queueReturn";
import type { QueueNotice } from "../routes";
import NotSubmittedPanel from "../components/NotSubmittedPanel";
import FormAnswers from "../components/FormAnswers";
import AuthenticationReport from "../components/AuthenticationReport";
import OverrideDialog from "../components/OverrideDialog";
import ReviewerTabs from "../components/ReviewerTabs";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import { ReviewerCaseHeader } from "../components/PageHeader";
import { Loading, LoadError } from "../components/LoadState";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  InfoIcon,
  MessageIcon,
  ShieldCheckIcon,
} from "../components/icons";
import type { QuestionAuthResult } from "../domain/types";
import type { Verdict } from "../api/types";

interface Pending {
  result: QuestionAuthResult;
  verdict: Verdict;
}

export default function ReviewerAuthenticationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const view = useCaseView(id);
  // The applicant's answers are shown only for a draft not submitted yet, so only read then.
  const isDraft = view.status === "ready" && view.data.stage === "NOT_SUBMITTED";
  const form = useForm(id, isDraft);
  // Only for showing an unsubmitted draft: read then, not for a submitted case.
  const catalogue = useCatalogue(id, isDraft);
  const rule = useRule(id);
  const undo = useUndoRuling(id);
  const retry = useRetry(id);
  const removal = useRemoveAssessment(id);
  const completeReview = useCompleteReview(id);
  const me = useSession().data;
  // Asking to confirm before the case goes back to the applicant.
  const [confirmReturn, setConfirmReturn] = useState(false);

  if (view.status === "error") return <LoadError error={view.error} onRetry={view.retry} />;
  if (isDraft && form.isError && !form.data) return <LoadError error={form.error} onRetry={form.refetch} />;
  if (view.status === "loading" || (isDraft && !form.data)) return <Loading />;
  const { assessment: assignment, data, outcome } = view;
  const stage = data.stage;

  const back = (
    <footer className="actionbar">
      <button className="btn btn-ghost" onClick={() => navigate(queueUrl())}>
        <ArrowLeftIcon size={15} />
        Back to the queue
      </button>
    </footer>
  );

  // Nothing has been submitted, so there is nothing to authenticate or rule on yet.
  if (stage === "NOT_SUBMITTED") {
    const remove = () =>
      removal.mutate(undefined, {
        onSuccess: () => {
          const state: QueueNotice = { notice: `Assessment ${id} for ${assignment.applicantName} was removed.` };
          navigate(queueUrl(), { state });
        },
      });
    return (
      <div className="page">
        <ReviewerCaseHeader assignment={assignment} stage={stage} />
        <ReviewerTabs assessmentId={id} active="authentication" scoringReady={false} />
        <NotSubmittedPanel assignment={assignment} canRemove={assignment.removable} onRemove={remove} />
        {assignment.hasDraft && catalogue.data && form.data && (
          <>
            <div className="notice notice-info">
              <InfoIcon size={17} />
              <div>
                <strong>Draft — not submitted.</strong> This is what {assignment.applicantName} has
                entered so far. It can still change, and nothing is authenticated until they submit.
              </div>
            </div>
            {/* Document types as this form's questionnaire version gives them. */}
            <FormAnswers form={toApplicationForm(form.data, withFormOptions(catalogue.data, form.data), assignment)} />
          </>
        )}
        {back}
      </div>
    );
  }

  // Submitted, but the engine has not produced a report: still running, or the run failed.
  if (!outcome) {
    const failed = stage === "AUTH_FAILED";
    return (
      <div className="page">
        <ReviewerCaseHeader assignment={assignment} stage={stage} />
        <ReviewerTabs assessmentId={id} active="authentication" scoringReady={false} />
        <CaseReviewerBar id={id} assignment={assignment} data={data} />
        {failed && data.run?.unconfirmed && (
          <div className="notice notice-warning" role="note">
            <AlertTriangleIcon size={17} />
            <div>
              <strong>The engine may still be working on the last attempt.</strong> It did not confirm
              receiving it in time. Sending again starts a second run, so check with the engine team first.
            </div>
          </div>
        )}
        <EmptyState
          icon={failed ? <AlertTriangleIcon size={22} /> : <ShieldCheckIcon size={22} />}
          title={failed ? "Authentication could not run" : "Authentication in progress"}
          action={
            // Sending again is the reviewer's step: not for one another admin is reviewing.
            failed &&
            !heldByOther(data.reviewer, me) && (
              <button className="btn btn-primary" disabled={retry.isPending} onClick={() => retry.mutate()}>
                {retry.isPending ? "Sending…" : "Send again"}
              </button>
            )
          }
        >
          {failed
            ? "The authentication service could not process this submission. The applicant's answers and documents are kept; send it again to retry."
            : "The engine is reading the documents. The report appears here when it finishes."}
        </EmptyState>
        {back}
      </div>
    );
  }

  const open = unresolvedFlags(data);
  const issues = questionsWithIssues(outcome);
  // A reviewer never rules on their own application (the server refuses it too).
  const ownApplication = assignment.ownApplication;
  // Only the admin reviewing the case rules on it (another admin reads it; the server refuses too).
  const canRule = stage === "REVIEW_PENDING" && !ownApplication && !heldByOther(data.reviewer, me);
  // Every flag ruled on: the reviewer sends the case on with the footer's button.
  const reviewOutcome = canRule ? data.reviewOutcome : null;
  const rejectedNow = Object.entries(data.rulings)
    .filter(([, r]) => r.verdict === "rejected")
    .map(([qid]) => qid);

  const sendOn = () =>
    completeReview.mutate(undefined, {
      onSuccess: (updated) => {
        setConfirmReturn(false);
        // On to scoring: the scoring page shows its progress, then the score.
        if (updated.stage === "SCORING" || updated.stage === "DECISION_PENDING") navigate(routes.reviewerResult(id));
      },
    });

  const confirm = (comment: string) => {
    if (!pending) return;
    rule.mutate(
      { qid: pending.result.qid, verdict: pending.verdict, comment },
      // Kept open on a refusal, which the dialog explains, so the comment is not lost.
      { onSuccess: () => setPending(null) }
    );
  };

  const questionFooter = (result: QuestionAuthResult) => {
    if (result.status !== "issue") return null;
    const ruling = data.rulings[result.qid];

    if (ruling) {
      return (
        <div className="ruling-block">
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
          {canRule && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={undo.isPending}
              onClick={() => undo.mutate(result.qid)}
            >
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
            onClick={() => {
              rule.reset();
              setPending({ result, verdict: "accepted" });
            }}
          >
            <CheckCircleIcon size={14} />
            Accept with comment
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              rule.reset();
              setPending({ result, verdict: "rejected" });
            }}
          >
            <AlertTriangleIcon size={14} />
            Reject and return
          </button>
        </div>
      </div>
    );
  };

  const notice =
    ownApplication && stage === "REVIEW_PENDING" && open.length > 0 ? (
      <div className="notice notice-warning">
        <AlertTriangleIcon size={17} />
        <div>
          <strong>This is your own application.</strong> {open.length} flagged answer
          {open.length > 1 ? "s" : ""} ({open.join(", ")}) must be ruled on by another reviewer.
        </div>
      </div>
    ) : stage === "SCORING" && data.run?.scoreForced ? (
      <div className="notice notice-info">
        <InfoIcon size={17} />
        <div>
          <strong>The AI engine is scoring the assessment.</strong> You accepted every flagged
          answer, so it is scoring it and writing its summary. It comes to your decision once that
          is done.
        </div>
      </div>
    ) : reviewOutcome === "accept" ? (
      <div className="notice notice-info">
        <CheckCircleIcon size={17} />
        <div>
          <strong>You accepted every flagged answer.</strong> Choose Go to scoring and decision to
          have the AI engine score the assessment and write its summary. Until then you can still
          undo a ruling.
        </div>
      </div>
    ) : reviewOutcome === "return" ? (
      <div className="notice notice-warning">
        <AlertTriangleIcon size={17} />
        <div>
          <strong>
            You rejected {rejectedNow.length === 1 ? "an answer" : "answers"} ({rejectedNow.join(", ")}).
          </strong>{" "}
          Choose Return to applicant to send it back with your comments, so they can upload new
          evidence. Until then you can still undo a ruling.
        </div>
      </div>
    ) : issues.length === 0 ? (
      <div className="notice notice-good">
        <CheckCircleIcon size={17} />
        <div>
          <strong>Every answer was authenticated against its evidence.</strong> Nothing needs your
          judgment at this stage.
        </div>
      </div>
    ) : open.length > 0 && canRule ? (
      <div className="notice notice-critical">
        <AlertTriangleIcon size={17} />
        <div>
          <strong>
            {open.length} question{open.length > 1 ? "s" : ""} awaiting your ruling
          </strong>{" "}
          ({open.join(", ")}). Once every flagged answer has a ruling, send it on: Go to scoring
          and decision if you accepted them all (the AI engine scores it and writes its
          assessment), or Return to applicant if you rejected any.
        </div>
      </div>
    ) : (
      <div className="notice notice-info">
        <CheckCircleIcon size={17} />
        <div>
          <strong>All flagged answers have been ruled on.</strong>{" "}
          {stage === "AWAITING_APPLICANT"
            ? "The applicant has been asked for new evidence."
            : stage === "SCORING"
              ? "The AI engine is scoring the assessment and writing its summary. It comes to your decision once that is done."
              : "The assessment has moved on for the decision."}
        </div>
      </div>
    );

  return (
    <div className="page">
      <ReviewerCaseHeader assignment={assignment} stage={stage} />

      <ReviewerTabs
        assessmentId={id}
        active="authentication"
        scoringReady={isScored(stage) || stage === "SCORING"}
      />

      <CaseReviewerBar id={id} assignment={assignment} data={data} />

      <AuthenticationReport
        outcome={outcome}
        reviewState={(qid) => reviewStateFor(data, qid)}
        notice={notice}
        questionFooter={questionFooter}
      />

      {completeReview.isError && !confirmReturn && (
        <div className="notice notice-critical" role="alert">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>It was not sent on.</strong> {refusalMessage(completeReview.error, "detail")}
          </div>
        </div>
      )}

      {undo.isError && (
        <div className="notice notice-critical" role="alert">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>The ruling was not undone.</strong> {refusalMessage(undo.error, "qid")}
          </div>
        </div>
      )}

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate(queueUrl())}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
        {reviewOutcome === "accept" && (
          <button className="btn btn-primary" disabled={completeReview.isPending} onClick={sendOn}>
            {completeReview.isPending ? "Sending…" : "Go to scoring and decision"}
            <ArrowRightIcon size={15} />
          </button>
        )}
        {reviewOutcome === "return" && (
          <button
            className="btn btn-primary"
            disabled={completeReview.isPending}
            onClick={() => {
              completeReview.reset();
              setConfirmReturn(true);
            }}
          >
            <ArrowLeftIcon size={15} />
            Return to applicant
          </button>
        )}
        {(isScored(stage) || stage === "SCORING") && (
          <button className="btn btn-primary" onClick={() => navigate(routes.reviewerResult(id))}>
            Go to scoring and decision
            <ArrowRightIcon size={15} />
          </button>
        )}
      </footer>

      {confirmReturn && (
        <Modal labelledBy="return-title" onClose={() => setConfirmReturn(false)}>
          <span className="modal-icon">
            <AlertTriangleIcon size={20} />
          </span>
          <h2 id="return-title">Return to the applicant?</h2>
          <p className="modal-sub">
            {assignment.applicantName} is asked for new evidence for {rejectedNow.join(", ")} and sees
            your comments on {rejectedNow.length === 1 ? "it" : "them"}. Your rulings can no longer be
            changed once it is sent.
          </p>
          {completeReview.isError && (
            <p className="field-error" role="alert">
              {refusalMessage(completeReview.error, "detail")}
            </p>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmReturn(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={completeReview.isPending} onClick={sendOn}>
              {completeReview.isPending ? "Sending…" : "Return to applicant"}
            </button>
          </div>
        </Modal>
      )}

      {pending && (
        <OverrideDialog
          qid={pending.result.qid}
          question={pending.result.question}
          verdict={pending.verdict}
          failingChecks={pending.result.checks
            .filter((c) => c.status === "fail")
            .map((c) => `${c.label} — ${c.note}`)}
          busy={rule.isPending}
          error={rule.isError ? refusalMessage(rule.error, "comment") : undefined}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

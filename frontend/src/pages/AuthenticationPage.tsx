import { useNavigate, useParams } from "react-router-dom";
import { useCatalogue, useForm, useRemoveEvidence, useResubmit, useUploadEvidence } from "../api/queries";
import { ApiError } from "../api/client";
import { useCaseView } from "../api/useCaseView";
import { evidenceRef, questionsWithIssues, reviewStateFor } from "../api/adapt";
import { isScored } from "../state/caseLabels";
import { defaultOptionCode, documentLabel, optionsFor, withFormOptions } from "../domain/catalogue";
import { routes } from "../routes";
import OutcomeTabs from "../components/OutcomeTabs";
import AuthenticationReport from "../components/AuthenticationReport";
import EvidenceBlock from "../components/EvidenceBlock";
import { sourceFields } from "../domain/attachSource";
import { DocumentDragContext, useDocumentDragState } from "../state/documentDrag";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { Loading, LoadError } from "../components/LoadState";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  MessageIcon,
  ShieldCheckIcon,
} from "../components/icons";
import type { QuestionAuthResult } from "../domain/types";

export default function AuthenticationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const view = useCaseView(id);
  // The form's current documents and the catalogue are needed to replace rejected evidence.
  const form = useForm(id);
  const catalogue = useCatalogue(id);
  const upload = useUploadEvidence(id);
  const remove = useRemoveEvidence(id);
  const resubmit = useResubmit(id);
  // Files dragged over the page, so a sent-back answer's document can be replaced by dropping one.
  const drag = useDocumentDragState();

  if (view.status === "error") return <LoadError error={view.error} onRetry={view.retry} />;
  const failed = [form, catalogue].find((q) => q.isError && q.data === undefined);
  if (failed) return <LoadError error={failed.error} onRetry={failed.refetch} />;
  if (view.status === "loading" || !form.data || !catalogue.data) return <Loading />;
  const { assessment, data, outcome } = view;
  const stage = data.stage;

  const header = (
    <PageHeader
      title="Authentication result"
      sub={
        <>
          Each answer is checked against the document attached to it.{" "}
          {assessment.department.name} · {assessment.reference}
        </>
      }
    />
  );

  // No report yet: the engine is still reading the documents, or could not run.
  if (!outcome) {
    return (
      <div className="page">
        {header}
        <EmptyState
          icon={<ShieldCheckIcon size={22} />}
          title={stage === "AUTH_FAILED" ? "Authentication could not run" : "Authentication in progress"}
          action={
            <button className="btn btn-primary" onClick={() => navigate(routes.applyStatus(id))}>
              Go to status
            </button>
          }
        >
          {stage === "AUTH_FAILED"
            ? "The report will appear here once the submission has been sent again from the status page."
            : "Your documents are being read and checked. The report appears here when it finishes."}
        </EmptyState>
      </div>
    );
  }

  const issues = questionsWithIssues(outcome);
  // Only a rejection puts the ball back in the applicant's court.
  const mustResubmit = stage === "AWAITING_APPLICANT";
  const rejected = data.rejected;
  // A question added here takes the document types of the version this case was submitted under.
  const cat = catalogue.data && form.data ? withFormOptions(catalogue.data, form.data) : catalogue.data;
  // Each answer sent back needs a document added since the run it was rejected in; the backend
  // says which still lack one (and refuses a resubmission until none do).
  const unreplaced = mustResubmit ? data.unreplaced : [];

  const questionFooter = (result: QuestionAuthResult) => {
    if (!mustResubmit || !rejected.includes(result.qid)) return null;
    const ruling = data.rulings[result.qid];
    // The rules of the version this case was submitted under, which the upload is checked against.
    const rules = form.data.answers.find((a) => a.qid === result.qid);
    const evidence = form.data.evidence.filter((e) => e.qid === result.qid).map(evidenceRef);

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
        {rules && (
          <EvidenceBlock
            qid={result.qid}
            evidence={evidence}
            options={optionsFor(cat, result.qid)}
            defaultCode={defaultOptionCode(cat, result.qid)}
            fileTypes={rules.fileTypes}
            allowSupporting={rules.maxFiles > 1}
            labelFor={(file) => documentLabel(cat, file, result.qid)}
            library={form.data.documents ?? []}
            onAttach={(optionCode, role, source, description) =>
              upload.mutateAsync({ qid: result.qid, optionCode, role, description, ...sourceFields(source) })
            }
            onRemove={remove.mutateAsync}
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
        ({rejected.join(", ")}). Attach the evidence they asked for below, then resubmit. The
        assessment goes back for authentication.
      </div>
    </div>
  ) : issues.length > 0 && isScored(stage) ? (
    <div className="notice notice-info">
      <CheckCircleIcon size={17} />
      <div>
        <strong>
          The reviewer accepted {issues.length === 1 ? "the answer" : `all ${issues.length} answers`} the engine
          could not authenticate
        </strong>{" "}
        ({issues.map((q) => q.qid).join(", ")}). The submission passed to scoring.
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
    <DocumentDragContext.Provider value={drag}>
    <div className="page">
      {header}

      <OutcomeTabs assessmentId={id} active="authentication" scoringReady={isScored(stage)} />

      <AuthenticationReport
        outcome={outcome}
        reviewState={(qid) => reviewStateFor(data, qid)}
        notice={notice}
        questionFooter={questionFooter}
      />

      {resubmit.isError && (
        <div className="notice notice-critical" role="alert">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>The assessment was not resubmitted.</strong>{" "}
            {resubmit.error instanceof ApiError && resubmit.error.status === 409
              ? resubmit.error.message
              : "Check your connection and try again."}
          </div>
        </div>
      )}

      <footer className="actionbar">
        {unreplaced.length > 0 && (
          <span className="actionbar-note" id="resubmit-blocked">
            Attach new evidence for {unreplaced.join(", ")} to resubmit
          </span>
        )}
        <button className="btn btn-ghost" onClick={() => navigate(routes.applyStatus(id))}>
          <ArrowLeftIcon size={15} />
          Back to status
        </button>
        {mustResubmit && (
          <button
            className="btn btn-primary"
            disabled={resubmit.isPending || unreplaced.length > 0}
            aria-describedby={unreplaced.length > 0 ? "resubmit-blocked" : undefined}
            onClick={() => resubmit.mutate(undefined, { onSuccess: () => navigate(routes.applyStatus(id), { replace: true }) })}
          >
            {resubmit.isPending ? "Resubmitting…" : "Resubmit for authentication"}
            <ArrowRightIcon size={15} />
          </button>
        )}
      </footer>
    </div>
    </DocumentDragContext.Provider>
  );
}

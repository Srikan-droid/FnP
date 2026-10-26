import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useMaxUploadBytes,
  useFormBusy,
  useRefreshCase,
  useRemoveDocument,
  useRemoveEvidence,
  useSaveForm,
  useUploadDocument,
  useUploadEvidence,
} from "../api/queries";
import type { SaveRefusal } from "../api/queries";
import { ApiError } from "../api/client";
import { useApplication } from "../api/useApplication";
import QuestionCard from "../components/QuestionCard";
import LeaveLockedPage from "../components/LeaveLockedPage";
import EvidenceBlock from "../components/EvidenceBlock";
import { sourceFields, type AttachSource } from "../domain/attachSource";
import DocumentLibrary from "../components/DocumentLibrary";
import PageHeader, { AssignmentMeta } from "../components/PageHeader";
import { Loading, LoadError } from "../components/LoadState";
import { ArrowRightIcon, AlertTriangleIcon, ChevronDownIcon, InfoIcon } from "../components/icons";
import { documentRuleBreaks, evidenceGaps, hasMissingMandatoryEvidence } from "../domain/evidenceRules";
import {
  CV_QID,
  DEFAULT_MAX_UPLOAD_BYTES,
  defaultOptionCode,
  documentLabel,
  optionsFor,
  question,
  withFormOptions,
} from "../domain/catalogue";
import { displaySection } from "../domain/sectionLabels";
import { routes } from "../routes";
import type { EvidenceRole } from "../domain/types";
import { DocumentDragContext, leftFor, useDocumentDragState } from "../state/documentDrag";

/** What the banner says about a refused save. */
function refusalText(refusal: SaveRefusal): string {
  const { error, changes } = refusal;
  if (!(error instanceof ApiError) || error.status >= 500) return "Check your connection and make the change again.";
  if (error.status === 400) {
    if (Object.keys(changes.answers ?? {}).some((qid) => error.field(`answers.${qid}`) === "Unknown question.")) {
      return "This question is no longer asked: the department changed the questions. The form now shows the current ones.";
    }
    if (Object.keys(changes.answers ?? {}).some((qid) => error.field(`answers.${qid}`))) {
      return "The question's options have changed; the form now shows the current ones. Make the change again.";
    }
  }
  return error.message;
}

export default function ApplyPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const data = useApplication(id);
  const { save, refusal } = useSaveForm(id);
  const upload = useUploadEvidence(id);
  const remove = useRemoveEvidence(id);
  const uploadDocument = useUploadDocument(id);
  const removeDocument = useRemoveDocument(id);
  const refreshCase = useRefreshCase(id);
  const maxBytes = useMaxUploadBytes(id) ?? DEFAULT_MAX_UPLOAD_BYTES;
  // Whether a change is still being sent, and whether one has been saved on this visit: the action
  // bar says "Saving…", then "All changes saved".
  const busy = useFormBusy(id);
  const [savedOnce, setSavedOnce] = useState(false);
  // Only sections the filer has explicitly toggled appear here; the rest fall back to the
  // default of opening the first section and leaving the others collapsed.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  // What is being dragged across the form, so each question can say whether it takes it.
  const drag = useDocumentDragState();
  // A closed section held under a dragged document opens after a moment, to reach its questions.
  const springTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (springTimer.current) window.clearTimeout(springTimer.current);
    },
    []
  );
  // The questionnaire edition the page opened on: if the department changes the questions while
  // the form is open, the applicant is told to check their answers.
  const [openedOn, setOpenedOn] = useState<string | undefined>(undefined);
  const formVersion = data.status === "ready" ? data.raw.version : undefined;
  if (openedOn === undefined && formVersion !== undefined) setOpenedOn(formVersion);
  const questionsChanged = openedOn !== undefined && formVersion !== undefined && formVersion !== openedOn;

  if (data.status === "loading") return <Loading />;
  if (data.status === "error") return <LoadError error={data.error} onRetry={data.retry} />;
  const { assessment, raw, form } = data;
  const catalogue = withFormOptions(data.catalogue, raw);

  // Once submitted, the form is locked: the reviewer's work is against what was submitted, and
  // the browser's Back button must not be a way to edit or resubmit underneath it.
  if (raw.locked) return <LeaveLockedPage to={routes.applyStatus(assessment.id)} />;

  const sections = Array.from(new Set(form.responses.map((r) => r.section)));
  // The question's text and options come from the catalogue; the rules it is checked against
  // come from the form, which is always current (the catalogue may be a few minutes old).
  // The form only lists questions both have (see toApplicationForm), so neither lookup misses;
  // a question that somehow did is left out rather than taking the page down.
  const rules = new Map(raw.answers.map((a) => [a.qid, a]));
  const questionFor = (qid: string) => {
    const rule = rules.get(qid);
    const text = question(catalogue, qid);
    if (!rule || !text) return undefined;
    return { ...text, allowedAnswers: rule.allowedAnswers, fileTypes: rule.fileTypes, maxFiles: rule.maxFiles };
  };

  // The banner reports a refused answer; useSaveForm already reloads the form after it.
  const saveAnswer = (qid: string, answer: string) =>
    save({ answers: { [qid]: answer } })
      .then(() => setSavedOnce(true))
      .catch(() => {});
  const cv = form.cv_verification;
  const { cvMissing, requiredTotal, missingTotal, missingIds } = evidenceGaps(form);
  const ruleBreaks = documentRuleBreaks(raw, catalogue.cvFileTypes);

  const toggleSection = (section: string, isOpen: boolean) =>
    setOpenSections((prev) => ({ ...prev, [section]: !isOpen }));
  const dragging = Boolean(drag.doc) || drag.files;
  // Started once while the pointer stays on the header (dragenter and dragover keep coming as it
  // crosses the header's own parts); a real leave cancels it.
  const springOpen = (section: string) => {
    if (springTimer.current) return;
    springTimer.current = window.setTimeout(() => {
      setOpenSections((prev) => ({ ...prev, [section]: true }));
      springTimer.current = null;
    }, 600);
  };
  const springCancel = () => {
    if (springTimer.current) window.clearTimeout(springTimer.current);
    springTimer.current = null;
  };

  // "All changes saved" only while the last change did save: a failed upload or removal (reported
  // at the document) clears it until the next change that goes through.
  const settled = <T,>(work: Promise<T>) =>
    work.then(
      (result) => {
        setSavedOnce(true);
        return result;
      },
      (error: unknown) => {
        setSavedOnce(false);
        throw error;
      }
    );
  const attach = (qid: string) => (optionCode: string, role: EvidenceRole, source: AttachSource, description?: string) =>
    settled(upload.mutateAsync({ qid, optionCode, role, description, ...sourceFields(source) }));
  const removeEvidence = (evidenceId: string) => settled(remove.mutateAsync(evidenceId));

  // "Your documents": everything uploaded.
  const library = raw.documents ?? [];
  // The formats the library takes, as the server checks them (an older server leaves them out:
  // every format a question or the CV takes).
  const libraryTypes =
    raw.documentsFileTypes ?? Array.from(new Set([...raw.answers.flatMap((a) => a.fileTypes), ...catalogue.cvFileTypes]));

  return (
    <DocumentDragContext.Provider value={drag}>
      <div className="page page-apply">
        <PageHeader
          title="Data collection"
          sub={
            <>
              {form.responses.length} questions across {sections.length} sections. Fields marked{" "}
              <span className="required-mark">*</span> are mandatory — attach supporting documents
              where they are asked for.
            </>
          }
        >
          <AssignmentMeta assignment={assessment} showDepartment />
        </PageHeader>

        {questionsChanged && (
          <div className="notice notice-info" role="status">
            <InfoIcon size={17} />
            <div>
              <strong>The questions for this application were updated.</strong> Its department changed
              them while you were filling it in; the form now shows the current ones. Please check
              your answers.
            </div>
          </div>
        )}

        {refusal && (
          <div className="notice notice-critical" role="alert">
            <AlertTriangleIcon size={17} />
            <div>
              <strong>Your last change was not saved.</strong> {refusalText(refusal)}
            </div>
          </div>
        )}

        {/* "Your documents" first, so on a narrow screen it comes above the questions; beside them
            (and kept in view) where there is room. */}
        <div className="apply-layout">
          <aside className="apply-side" aria-label="Your documents">
            <DocumentLibrary
              documents={library}
              max={raw.documentsMax ?? 30}
              fileTypes={libraryTypes}
              maxBytes={maxBytes}
              qidLabel={(qid) => qid}
              onUpload={(file, onProgress) => settled(uploadDocument.mutateAsync({ file, onProgress }))}
              onRemove={(documentId) => settled(removeDocument.mutateAsync(documentId))}
              onDrained={refreshCase}
            />
          </aside>

          <div className="apply-main">
            {sections.map((section, index) => {
              const items = form.responses.filter((r) => r.section === section);
              const missingHere = items.filter(hasMissingMandatoryEvidence).length;
              const isOpen = openSections[section] ?? index === 0;
              const bodyId = `section-body-${index}`;

              return (
                <section className="card section" key={section}>
                  <h2 className="section-head-wrap">
                    <button
                      className={`section-head${dragging && !isOpen ? " is-spring" : ""}`}
                      aria-expanded={isOpen}
                      aria-controls={bodyId}
                      onClick={() => toggleSection(section, isOpen)}
                      onDragEnter={() => {
                        if (dragging && !isOpen) springOpen(section);
                      }}
                      onDragOver={() => {
                        if (dragging && !isOpen) springOpen(section);
                      }}
                      onDragLeave={(e) => {
                        if (leftFor(e)) springCancel();
                      }}
                      onDrop={springCancel}
                    >
                      <span className="section-chevron">
                        <ChevronDownIcon size={15} />
                      </span>
                      <span className="section-title">{displaySection(section)}</span>
                      {missingHere > 0 && (
                        <span className="section-flag">
                          <AlertTriangleIcon size={12} />
                          {missingHere} missing
                        </span>
                      )}
                      <span className="section-count">
                        {items.length} question{items.length > 1 ? "s" : ""}
                      </span>
                    </button>
                  </h2>

                  {isOpen && (
                    <div className="section-body" id={bodyId}>
                      {items.map((r) => {
                        const q = questionFor(r.qid);
                        return (
                          q && (
                            <QuestionCard
                              key={r.qid}
                              response={r}
                              question={q}
                              options={optionsFor(catalogue, r.qid)}
                              defaultCode={defaultOptionCode(catalogue, r.qid)}
                              labelFor={(file) => documentLabel(catalogue, file, r.qid)}
                              library={library}
                              onAnswerChange={(answer) => saveAnswer(r.qid, answer)}
                              onAttach={attach(r.qid)}
                              onRemove={removeEvidence}
                            />
                          )
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}

            {cv && (
              <section className="card section">
                <h2 className="section-head-wrap">
                  <div className="section-head section-head-static">
                    <span className="section-title">Curriculum vitae</span>
                    {cvMissing && (
                      <span className="section-flag">
                        <AlertTriangleIcon size={12} />1 missing
                      </span>
                    )}
                    <span className="section-count">Supplementary</span>
                  </div>
                </h2>
                <div className="section-body">
                  <article className="qcard" id={`question-${CV_QID}`}>
                    <div className="qcard-main">
                      <div className="qcard-prompt">
                        <span className="qid">CV</span>
                        <p className="qtext">
                          Attach the applicant's curriculum vitae.
                          <span className="required-mark" aria-hidden="true">
                            *
                          </span>
                          <span className="qhint">
                            Checked against the qualification, experience and directorships established
                            by the documents above. Reviewer-facing only — it does not affect the score.
                          </span>
                        </p>
                      </div>
                    </div>
                    <EvidenceBlock
                      qid={CV_QID}
                      evidence={cv.evidence}
                      options={optionsFor(catalogue, CV_QID)}
                      defaultCode={defaultOptionCode(catalogue, CV_QID)}
                      fileTypes={catalogue.cvFileTypes}
                      allowSupporting={false}
                      labelFor={(file) => documentLabel(catalogue, file, CV_QID)}
                      library={library}
                      onAttach={attach(CV_QID)}
                      onRemove={removeEvidence}
                    />
                  </article>
                </div>
              </section>
            )}

            {missingTotal > 0 && (
              <div className="notice notice-warning">
                <AlertTriangleIcon size={17} />
                <div>
                  <strong>
                    {missingTotal} required document{missingTotal > 1 ? "s" : ""} not attached
                  </strong>{" "}
                  ({missingIds.join(", ")}). Attach{" "}
                  {missingTotal > 1 ? "them" : "it"} before submitting.
                </div>
              </div>
            )}

            {ruleBreaks.length > 0 && (
              <div className="notice notice-warning">
                <AlertTriangleIcon size={17} />
                <div>
                  <strong>Replace documents that no longer meet the question settings</strong> (
                  {ruleBreaks.join("; ")}). The settings changed after they were attached; remove each
                  and attach it again in an accepted format.
                </div>
              </div>
            )}

          </div>
        </div>

        <footer className="actionbar">
          <span className="actionbar-note">
            {requiredTotal - missingTotal} of {requiredTotal} required documents attached
            <span className="save-state" role="status">
              {busy ? " · Saving…" : savedOnce && !refusal ? " · All changes saved" : ""}
            </span>
          </span>
          <button
            className="btn btn-primary"
            onClick={() => navigate(routes.applyReview(assessment.id))}
          >
            Continue to review
            <ArrowRightIcon size={15} />
          </button>
        </footer>
      </div>
    </DocumentDragContext.Provider>
  );
}

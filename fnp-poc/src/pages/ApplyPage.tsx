import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import QuestionCard from "../components/QuestionCard";
import EvidenceBlock from "../components/EvidenceBlock";
import EvidenceTray from "../components/EvidenceTray";
import { useUploads } from "../state/useUploads";
import type { AssignTarget } from "../components/EvidenceTray";
import type { UploadedFileMeta } from "../state/uploadStore";
import AssessmentNotFound from "../components/AssessmentNotFound";
import { ArrowRightIcon, AlertTriangleIcon, ChevronDownIcon } from "../components/icons";
import { hasMissingMandatoryEvidence } from "../domain/evidenceRules";
import {
  CV_QID,
  fileNameFor,
  findOption,
  OTHER_OPTION,
} from "../domain/evidenceOptions";
import { displaySection } from "../domain/sectionLabels";
import { defaultConfig, readConfig } from "../state/questionConfigStore";
import { stageFor } from "../state/caseStore";
import type { Answer, EvidenceRole } from "../domain/types";

export default function ApplyPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm, updateAnswer, attachEvidence, removeEvidence, attachCvEvidence, removeCvEvidence } =
    useAssessment();
  // Only sections the filer has explicitly toggled appear here; the rest fall back to the
  // default of opening the first section and leaving the others collapsed.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const assignment = getAssignment(id);
  // Called unconditionally, before the guard below, so the hook order never changes.
  const uploads = useUploads(id);
  // The file currently being dragged out of the evidence bundle, shared with every question so
  // each can show its document types as drop targets.
  const [draggingFile, setDraggingFile] = useState<UploadedFileMeta | null>(null);

  if (!assignment) return <AssessmentNotFound />;

  // Reviewer configuration reaches a filer only before they submit; afterwards the assessment
  // keeps the rules it was authenticated and scored against.
  const configApplies = stageFor(assignment.id, []) === "NOT_SUBMITTED";
  const config = configApplies ? readConfig() : null;
  // What each question actually accepts. A submitted assessment keeps the published rules
  // rather than the reviewer's current ones, but it still has real rules — falling back to a
  // single format here would wrongly report usable documents as unusable.
  const effectiveRules = config ?? defaultConfig();

  const form = getForm(assignment);
  const sections = Array.from(new Set(form.responses.map((r) => r.section)));
  const required = form.responses.filter((r) => r.evidence_required);
  const missing = required.filter(hasMissingMandatoryEvidence);
  // The CV is mandatory but sits outside the 15 questions, so it is counted alongside them
  // rather than through the question list.
  const cv = form.cv_verification;
  const cvMissing = Boolean(cv?.mandatory) && (cv?.evidence.length ?? 0) === 0;
  const requiredTotal = required.length + (cv?.mandatory ? 1 : 0);
  const missingTotal = missing.length + (cvMissing ? 1 : 0);

  // Questions a tray file can be dropped on, with the formats each one accepts.
  const assignTargets: AssignTarget[] = form.responses
    .filter((r) => r.evidence_required)
    .map((r) => ({
      qid: r.qid,
      section: r.section,
      question: r.question,
      fileTypes: effectiveRules[r.qid]?.fileTypes ?? ["pdf"],
      attached: r.evidence.length > 0,
    }));
  if (form.cv_verification) {
    assignTargets.push({
      qid: CV_QID,
      section: "Curriculum vitae",
      question: "Curriculum vitae",
      fileTypes: ["pdf"],
      attached: form.cv_verification.evidence.length > 0,
    });
  }

  /** How many questions each uploaded file is attached to, for the tray listing. */
  const assignedCounts: Record<string, number> = {};
  const countAttachment = (uploadId?: string) => {
    if (!uploadId) return;
    assignedCounts[uploadId] = (assignedCounts[uploadId] ?? 0) + 1;
  };
  form.responses.forEach((r) => r.evidence.forEach((e) => countAttachment(e.upload_id)));
  form.cv_verification?.evidence.forEach((e) => countAttachment(e.upload_id));

  /**
   * A dropped file carries real bytes, so it is linked rather than simulated. The document
   * type comes from the row the filer released it on, not from the file name.
   */
  const attachUpload = (
    qid: string,
    uploadId: string,
    role: EvidenceRole,
    optionCode: string
  ) => {
    const file = uploads.byId(uploadId);
    const option = findOption(qid, optionCode);
    if (!file || !option) return;
    const ref = {
      doc_type: option.docType,
      role,
      option_code: option.code,
      upload_id: uploadId,
      file_name: file.name,
      // "Other" needs a description; the file name is the only thing a drop can supply.
      description: option.code === OTHER_OPTION.code ? file.name : undefined,
    };
    if (qid === CV_QID) attachCvEvidence(assignment, ref);
    else attachEvidence(assignment, qid, ref);
    setDraggingFile(null);
  };

  const toggleSection = (section: string, isOpen: boolean) =>
    setOpenSections((prev) => ({ ...prev, [section]: !isOpen }));

  const handleAttachCv = (optionCode: string, _role: EvidenceRole, description?: string) => {
    const option = findOption(CV_QID, optionCode);
    if (!option) return;
    attachCvEvidence(assignment, {
      doc_type: option.docType,
      path: `evidence/${assignment.applicantId}/${fileNameFor(option)}`,
      role: "primary",
      option_code: option.code,
      description,
    });
  };

  const handleAttachEvidence = (
    qid: string,
    optionCode: string,
    role: EvidenceRole,
    description?: string
  ) => {
    const option = findOption(qid, optionCode);
    if (!option) return;
    attachEvidence(assignment, qid, {
      doc_type: option.docType,
      path: `evidence/${assignment.applicantId}/${fileNameFor(option, config?.[qid]?.fileTypes)}`,
      role,
      option_code: option.code,
      description,
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Data collection</h1>
          <p className="page-sub">
            {form.responses.length} questions across {sections.length} sections. Fields marked{" "}
            <span className="required-mark">*</span> are mandatory — attach supporting documents
            where they are asked for.
          </p>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Requested by</dt>
            <dd>{departmentFor(assignment).name}</dd>
          </div>
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

      <div className="page-split">
        <div className="page-main">
      {sections.map((section, index) => {
        const items = form.responses.filter((r) => r.section === section);
        const missingHere = items.filter(hasMissingMandatoryEvidence).length;
        const isOpen = openSections[section] ?? index === 0;
        const bodyId = `section-body-${index}`;

        return (
          <section className="card section" key={section}>
            <h2 className="section-head-wrap">
              <button
                className="section-head"
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => toggleSection(section, isOpen)}
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
                {items.map((r) => (
                  <QuestionCard
                    key={r.qid}
                    response={r}
                    config={config?.[r.qid]}
                    uploadUrlFor={uploads.urlFor}
                    draggingFile={draggingFile}
                    onDropUpload={attachUpload}
                    onAnswerChange={(qid: string, answer: Answer) =>
                      updateAnswer(assignment, qid, answer)
                    }
                    onAttachEvidence={handleAttachEvidence}
                    onRemoveEvidence={(qid: string, docType: string) =>
                      removeEvidence(assignment, qid, docType)
                    }
                  />
                ))}
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
            <article className="qcard">
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
                uploadUrlFor={uploads.urlFor}
                draggingFile={draggingFile}
                onDropUpload={(uploadId, role, optionCode) =>
                  attachUpload(CV_QID, uploadId, role, optionCode)
                }
                onAttach={handleAttachCv}
                onRemove={() => removeCvEvidence(assignment)}
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
            ({[...missing.map((r) => r.qid), ...(cvMissing ? ["CV"] : [])].join(", ")}). You can
            still submit — the engine will flag this during authentication.
          </div>
        </div>
      )}

        </div>

        <div className="page-rail">
          <EvidenceTray
            uploads={uploads}
            targets={assignTargets}
            assignedCounts={assignedCounts}
            onDragStateChange={setDraggingFile}
          />
        </div>
      </div>

      <footer className="actionbar">
        <span className="actionbar-note">
          {requiredTotal - missingTotal} of {requiredTotal} required documents attached
        </span>
        <button
          className="btn btn-primary"
          onClick={() => navigate(`/apply/${assignment.id}/review`)}
        >
          Continue to review
          <ArrowRightIcon size={15} />
        </button>
      </footer>
    </div>
  );
}

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import QuestionCard from "../components/QuestionCard";
import AssessmentNotFound from "../components/AssessmentNotFound";
import { ArrowRightIcon, AlertTriangleIcon, ChevronDownIcon } from "../components/icons";
import { DOC_TYPE_BY_QID, hasMissingMandatoryEvidence } from "../domain/evidenceRules";
import { displaySection } from "../domain/sectionLabels";
import type { Answer } from "../domain/types";

export default function ApplyPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm, updateAnswer, attachEvidence, removeEvidence } = useAssessment();
  // Only sections the filer has explicitly toggled appear here; the rest fall back to the
  // default of opening the first section and leaving the others collapsed.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const assignment = getAssignment(id);

  if (!assignment) return <AssessmentNotFound />;

  const form = getForm(assignment);
  const sections = Array.from(new Set(form.responses.map((r) => r.section)));
  const required = form.responses.filter((r) => r.evidence_required);
  const missing = required.filter(hasMissingMandatoryEvidence);

  const toggleSection = (section: string, isOpen: boolean) =>
    setOpenSections((prev) => ({ ...prev, [section]: !isOpen }));

  const handleAttachEvidence = (qid: string) => {
    const docType = DOC_TYPE_BY_QID[qid] ?? "document";
    attachEvidence(assignment, qid, {
      doc_type: docType,
      path: `evidence/${assignment.applicantId}/${docType}.pdf`,
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Data collection</h1>
          <p className="page-sub">
            {form.responses.length} questions across {sections.length} sections. Attach supporting
            documents where they are asked for.
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
                    applicantId={assignment.applicantId}
                    response={r}
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

      {missing.length > 0 && (
        <div className="notice notice-warning">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>
              {missing.length} required document{missing.length > 1 ? "s" : ""} not attached
            </strong>{" "}
            ({missing.map((r) => r.qid).join(", ")}). You can still submit — the engine will flag
            this during authentication.
          </div>
        </div>
      )}

      <footer className="actionbar">
        <span className="actionbar-note">
          {required.length - missing.length} of {required.length} required documents attached
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

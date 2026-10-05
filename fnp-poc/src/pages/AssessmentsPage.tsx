import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { hasDraft } from "../state/draftStore";
import { authenticate } from "../domain/authentication";
import { flaggedQids } from "../domain/reviewState";
import { stageFor } from "../state/caseStore";
import { STAGE_LABELS } from "../domain/caseLabels";
import type { CaseStage } from "../state/caseStore";
import { assignmentsForEmail, departmentFor, formatDate } from "../data/assignments";
import type { Assignment } from "../data/assignments";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BankIcon,
  ChartIcon,
  FileTextIcon,
  GraduationCapIcon,
  MailIcon,
  PencilIcon,
  PlusIcon,
  UmbrellaIcon,
  WalletIcon,
} from "../components/icons";

const DEPARTMENT_ICON: Record<string, typeof BankIcon> = {
  banking: BankIcon,
  education: GraduationCapIcon,
  insurance: UmbrellaIcon,
  microfinance: WalletIcon,
  payments: FileTextIcon,
  markets: ChartIcon,
};

type ModalStep = "choose" | "confirm";

/**
 * Where the second choice goes, given where the case actually stands. Only an unsubmitted form
 * is still editable: once it is with the reviewer, dropping the filer back into data collection
 * would let them change answers out from under a review that is already under way.
 */
function resumeFor(stage: CaseStage | null): { suffix: string; title: string; sub: string } {
  if (stage === "AWAITING_APPLICANT") {
    return {
      suffix: "/authentication",
      title: "Resubmit evidence",
      sub: "The reviewer asked for new documents",
    };
  }
  if (stage && stage !== "NOT_SUBMITTED") {
    return {
      suffix: "/status",
      title: "View this submission",
      sub: "Already submitted — track its progress",
    };
  }
  return { suffix: "", title: "Edit previous draft", sub: "Continue where you left off" };
}

export default function AssessmentsPage() {
  const navigate = useNavigate();
  const { email, getForm, startNewApplication } = useAssessment();
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [step, setStep] = useState<ModalStep>("choose");

  if (!email) return <Navigate to="/" replace />;

  const assignments = assignmentsForEmail(email);

  /** The stage each card shows, read from the shared case state. */
  const stageOf = (assignment: Assignment) => {
    if (assignment.isDummy) return null;
    const outcome = authenticate(
      assignment.id,
      assignment.applicantId,
      getForm(assignment)
    );
    return stageFor(assignment.id, flaggedQids(outcome));
  };

  const open = (assignment: Assignment) => {
    // Decorative cards carry no assessment, so there is nothing to open.
    if (assignment.isDummy) return;
    setSelected(assignment);
    setStep("choose");
  };

  const close = () => setSelected(null);

  const beginNew = () => {
    if (!selected) return;
    if (hasDraft(selected)) {
      setStep("confirm");
      return;
    }
    startNewApplication(selected);
    navigate(`/apply/${selected.id}`);
  };

  const confirmNew = () => {
    if (!selected) return;
    startNewApplication(selected);
    navigate(`/apply/${selected.id}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Your assessments</h1>
          <p className="page-sub">
            {assignments.length > 0
              ? `${assignments.length} fit and proper assessment${
                  assignments.length > 1 ? "s have" : " has"
                } been initiated against your applications. Complete each one for the department that requested it.`
              : "Fit and proper assessments initiated against your applications appear here."}
          </p>
        </div>
      </header>

      {assignments.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">
            <MailIcon size={22} />
          </span>
          <h2>No assessments for {email}</h2>
          <p>
            A fit and proper assessment is created by the department handling your licence or
            accreditation application. Once one is initiated, it will be listed here.
          </p>
        </div>
      ) : (
        <div className="tiles">
          {assignments.map((assignment) => {
            const department = departmentFor(assignment);
            const Icon = DEPARTMENT_ICON[assignment.departmentKey] ?? BankIcon;
            const started = hasDraft(assignment);
            const stage = stageOf(assignment);
            // A live card reports where its assessment actually stands; the decorative ones
            // only ever show that nothing has been started.
            const badge =
              stage && stage !== "NOT_SUBMITTED"
                ? { label: STAGE_LABELS[stage].applicant, tone: STAGE_LABELS[stage].tone }
                : {
                    label: started ? "Draft saved" : "Not started",
                    tone: started ? "info" : "neutral",
                  };
            return (
              <button
                className={`tile${assignment.isDummy ? " is-inert" : ""}`}
                key={assignment.id}
                onClick={() => open(assignment)}
                aria-disabled={assignment.isDummy}
              >
                <span className="tile-head">
                  <span className="tile-icon">
                    <Icon size={19} />
                  </span>
                  <span className={`chip chip-${badge.tone}`}>{badge.label}</span>
                </span>

                <span className="tile-dept">{department.name}</span>
                <span className="tile-blurb">{department.blurb}</span>

                <span className="tile-detail">
                  <span className="tile-label">Entity</span>
                  <span className="tile-value">{assignment.entity}</span>
                </span>
                <span className="tile-detail">
                  <span className="tile-label">Position</span>
                  <span className="tile-value">{assignment.position}</span>
                </span>

                <span className="tile-foot">
                  <span className="tile-ref">{assignment.reference}</span>
                  <span>Initiated {formatDate(assignment.initiatedOn)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="modal-overlay" role="presentation" onClick={close}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assessment-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {step === "choose" ? (
              <>
                <h2 id="assessment-modal-title">{departmentFor(selected).name}</h2>
                <p className="modal-sub">
                  Entity and position are carried over from application {selected.reference}.
                </p>

                <dl className="modal-detail">
                  <div>
                    <dt>Entity</dt>
                    <dd>{selected.entity}</dd>
                  </div>
                  <div>
                    <dt>Position applied for</dt>
                    <dd>{selected.position}</dd>
                  </div>
                </dl>

                <button className="choice" onClick={beginNew}>
                  <span className="choice-icon">
                    <PlusIcon size={17} />
                  </span>
                  <span className="choice-text">
                    <span className="choice-title">New application</span>
                    <span className="choice-sub">Start a blank form</span>
                  </span>
                  <ArrowRightIcon size={15} className="choice-arrow" />
                </button>

                {(() => {
                  const resume = resumeFor(stageOf(selected));
                  const available = hasDraft(selected);
                  return (
                    <button
                      className={`choice${available ? "" : " is-disabled"}`}
                      disabled={!available}
                      onClick={() => navigate(`/apply/${selected.id}${resume.suffix}`)}
                    >
                      <span className="choice-icon">
                        <PencilIcon size={17} />
                      </span>
                      <span className="choice-text">
                        <span className="choice-title">{resume.title}</span>
                        <span className="choice-sub">
                          {available ? resume.sub : "No saved draft yet"}
                        </span>
                      </span>
                      <ArrowRightIcon size={15} className="choice-arrow" />
                    </button>
                  );
                })()}

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={close}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="modal-icon">
                  <AlertTriangleIcon size={20} />
                </span>
                <h2 id="assessment-modal-title">Replace your saved draft?</h2>
                <p className="modal-sub">
                  Starting a new application clears everything saved for{" "}
                  {departmentFor(selected).name}. This cannot be undone.
                </p>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setStep("choose")}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={confirmNew}>
                    Replace and start
                    <ArrowRightIcon size={15} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

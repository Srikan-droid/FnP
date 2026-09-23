import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { hasDraft } from "../state/draftStore";
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

export default function AssessmentsPage() {
  const navigate = useNavigate();
  const { email, startNewApplication } = useAssessment();
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [step, setStep] = useState<ModalStep>("choose");

  if (!email) return <Navigate to="/" replace />;

  const assignments = assignmentsForEmail(email);

  const open = (assignment: Assignment) => {
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
            return (
              <button className="tile" key={assignment.id} onClick={() => open(assignment)}>
                <span className="tile-head">
                  <span className="tile-icon">
                    <Icon size={19} />
                  </span>
                  <span className={`chip ${started ? "chip-info" : "chip-neutral"}`}>
                    {started ? "Draft saved" : "Not started"}
                  </span>
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

                <button
                  className={`choice${hasDraft(selected) ? "" : " is-disabled"}`}
                  disabled={!hasDraft(selected)}
                  onClick={() => navigate(`/apply/${selected.id}`)}
                >
                  <span className="choice-icon">
                    <PencilIcon size={17} />
                  </span>
                  <span className="choice-text">
                    <span className="choice-title">Edit previous draft</span>
                    <span className="choice-sub">
                      {hasDraft(selected) ? "Continue where you left off" : "No saved draft yet"}
                    </span>
                  </span>
                  <ArrowRightIcon size={15} className="choice-arrow" />
                </button>

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

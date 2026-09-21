import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { APPLICANT_PROFILES } from "../data/fixtures";
import { ArrowRightIcon, PencilIcon, PlusIcon, ShieldCheckIcon } from "../components/icons";

export default function StartPage() {
  const navigate = useNavigate();
  const { startNewApplication } = useAssessment();
  const [idInput, setIdInput] = useState("");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [entityName, setEntityName] = useState("");
  const [positionAppliedFor, setPositionAppliedFor] = useState("");
  const [newAppError, setNewAppError] = useState("");

  const handleSubmitId = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = idInput.trim().toUpperCase();
    const known = APPLICANT_PROFILES.some((p) => p.id === normalized);
    if (!known) {
      setError(`No application found for "${idInput.trim()}". Check the ID and try again.`);
      setUserId("");
      return;
    }
    setError("");
    setUserId(normalized);
  };

  const handleNewApplication = () => {
    setEntityName("");
    setPositionAppliedFor("");
    setNewAppError("");
    setConfirmingNew(true);
  };

  const confirmNewApplication = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityName.trim() || !positionAppliedFor.trim()) {
      setNewAppError("Entity name and position applying for are both required.");
      return;
    }
    startNewApplication(userId, {
      entityName: entityName.trim(),
      positionAppliedFor: positionAppliedFor.trim(),
    });
    setConfirmingNew(false);
    navigate(`/apply/${userId}`);
  };

  return (
    <div className="hero">
      <div className="hero-aura" aria-hidden="true" />

      <section className="hero-card">
        <span className="hero-mark">
          <ShieldCheckIcon size={24} />
        </span>
        <h1 className="hero-title">Fit and Proper Assessment</h1>
        <p className="hero-org">Bank of Namibia</p>

        {!userId ? (
          <form className="hero-form" onSubmit={handleSubmitId}>
            <div className="field">
              <label className="field-label" htmlFor="app-id-input">
                Name or application ID
              </label>
              <input
                id="app-id-input"
                className="input"
                type="text"
                placeholder="e.g. APP001"
                value={idInput}
                onChange={(e) => setIdInput(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              {error && <p className="field-error">{error}</p>}
            </div>
            <button className="btn btn-primary btn-block" type="submit">
              Continue
              <ArrowRightIcon size={15} />
            </button>
          </form>
        ) : (
          <div className="hero-choices">
            <p className="hero-signed">
              Signed in as <strong>{userId}</strong>
            </p>

            <button className="choice" onClick={handleNewApplication}>
              <span className="choice-icon">
                <PlusIcon size={17} />
              </span>
              <span className="choice-text">
                <span className="choice-title">New application</span>
                <span className="choice-sub">Start a blank form</span>
              </span>
              <ArrowRightIcon size={15} className="choice-arrow" />
            </button>

            <button className="choice" onClick={() => navigate(`/apply/${userId}`)}>
              <span className="choice-icon">
                <PencilIcon size={17} />
              </span>
              <span className="choice-text">
                <span className="choice-title">Edit previous draft</span>
                <span className="choice-sub">Continue where you left off</span>
              </span>
              <ArrowRightIcon size={15} className="choice-arrow" />
            </button>

            <button
              className="btn btn-link"
              onClick={() => {
                setUserId("");
                setIdInput("");
                setError("");
              }}
            >
              Not you? Switch ID
            </button>
          </div>
        )}
      </section>

      <p className="hero-foot">Proof of concept · assessment engine v0.1</p>

      {confirmingNew && (
        <div className="modal-overlay" role="presentation">
          <form
            className="modal"
            onSubmit={confirmNewApplication}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-app-title"
          >
            <h2 id="new-app-title">New application</h2>
            <p className="modal-sub">
              This replaces {userId}'s existing draft, if any. This cannot be undone.
            </p>

            <div className="field">
              <label className="field-label" htmlFor="entity-name-input">
                Entity name
              </label>
              <input
                id="entity-name-input"
                className="input"
                type="text"
                placeholder="e.g. Oshakati Microfinance Bank Limited"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="position-input">
                Position applying for
              </label>
              <input
                id="position-input"
                className="input"
                type="text"
                placeholder="e.g. Non-Executive Director"
                value={positionAppliedFor}
                onChange={(e) => setPositionAppliedFor(e.target.value)}
                autoComplete="off"
              />
            </div>

            {newAppError && <p className="field-error">{newAppError}</p>}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmingNew(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Create application
                <ArrowRightIcon size={15} />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { ArrowRightIcon, ShieldCheckIcon } from "../components/icons";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAssessment();
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = emailInput.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    signIn(value);
    navigate("/assessments");
  };

  return (
    <div className="hero">
      <div className="hero-aura" aria-hidden="true" />

      <section className="hero-card">
        <span className="hero-mark">
          <ShieldCheckIcon size={24} />
        </span>
        <h1 className="hero-title">Fit and Proper Assessment</h1>
        <p className="hero-org">Applicant portal</p>

        <form className="hero-form" onSubmit={handleSubmit}>
          <div className="field">
            <label className="field-label" htmlFor="email-input">
              Email address
            </label>
            <input
              id="email-input"
              className="input"
              type="email"
              placeholder="you@example.na"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              autoComplete="email"
              autoFocus
            />
            {error && <p className="field-error">{error}</p>}
          </div>
          <button className="btn btn-primary btn-block" type="submit">
            Continue
            <ArrowRightIcon size={15} />
          </button>
          <p className="hero-hint">
            Assessments appear here once a department initiates one against your application.
          </p>
        </form>
      </section>

      <p className="hero-foot">Proof of concept · assessment engine v0.1</p>
    </div>
  );
}

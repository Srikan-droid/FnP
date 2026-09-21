import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckIcon } from "../components/icons";

const STEPS = [
  { title: "Submission received", detail: "Form JSON and evidence paths sent to the assessment API" },
  { title: "Authenticating data", detail: "Declared values checked field by field against each document" },
  { title: "Calculating score", detail: "Weighted risk applied to authenticated answers only" },
  { title: "Generating report", detail: "Score, band and recommendation compiled" },
];

export default function ProcessingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (stepIndex >= STEPS.length - 1) {
      const finish = setTimeout(() => navigate(`/apply/${id}/result`), 800);
      return () => clearTimeout(finish);
    }
    const tick = setTimeout(() => setStepIndex((i) => i + 1), 700);
    return () => clearTimeout(tick);
  }, [stepIndex, id, navigate]);

  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  return (
    <div className="page page-narrow">
      <header className="page-head page-head-center">
        <div className="page-head-text">
          <h1>Assessment in progress</h1>
          <p className="page-sub">This usually takes a few seconds.</p>
        </div>
      </header>

      <section className="card processing">
        <div className="progress-track" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <ol className="processing-steps">
          {STEPS.map((step, i) => {
            const state = i < stepIndex ? "is-done" : i === stepIndex ? "is-active" : "is-todo";
            return (
              <li key={step.title} className={state}>
                <span className="processing-marker">
                  {i < stepIndex ? <CheckIcon size={13} /> : <span className="processing-pulse" />}
                </span>
                <span className="processing-text">
                  <span className="processing-title">{step.title}</span>
                  <span className="processing-detail">{step.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

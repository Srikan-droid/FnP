import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getExpectedFields } from "../data/fixtures";
import { authenticate, score } from "../domain/engine";
import ReportView from "../components/ReportView";
import { AlertTriangleIcon, ArrowLeftIcon, ArrowRightIcon } from "../components/icons";
import type { Verdict } from "../domain/types";

const VERDICT_COPY: Record<string, { label: string; tone: string }> = {
  MISMATCH: { label: "Evidence contradicts the value entered", tone: "critical" },
  CONTRADICTION: { label: "Evidence contradicts the Yes/No answer itself", tone: "critical" },
  EVIDENCE_MISSING: { label: "Mandatory document was not uploaded", tone: "warning" },
  UNVERIFIABLE: { label: "Document uploaded, but the field is not in it", tone: "serious" },
};

const verdictCopy = (verdict: Verdict) =>
  VERDICT_COPY[verdict] ?? { label: verdict, tone: "neutral" };

export default function ResultPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm } = useAssessment();
  const form = getForm(id);

  const authResult = useMemo(() => authenticate(id, getExpectedFields(id)), [id]);
  const scoreResult = useMemo(
    () => (authResult.isClean ? score(form) : null),
    [authResult.isClean, form]
  );

  if (!authResult.isClean) {
    const count = authResult.blockingFields.length;
    return (
      <div className="page">
        <header className="page-head">
          <div className="page-head-text">
            <span className="chip chip-critical">
              <AlertTriangleIcon size={14} />
              Returned to filer
            </span>
            <h1>
              Authentication found {count} issue{count > 1 ? "s" : ""}
            </h1>
            <p className="page-sub">
              Scoring did not run — the engine only scores a fully authenticated submission.
              Correct the fields below and resubmit.
            </p>
          </div>
        </header>

        <div className="findings">
          {authResult.blockingFields.map((f, i) => {
            const copy = verdictCopy(f.expected);
            return (
              <article className="card finding" key={`${f.qid}-${f.field}-${i}`}>
                <header className="finding-head">
                  <span className="qid">{f.qid}</span>
                  <span className="finding-field">{f.field.replaceAll("_", " ")}</span>
                  <span className={`chip chip-${copy.tone}`}>{f.expected}</span>
                </header>

                <p className="finding-reason">{copy.label}</p>

                <div className="diff">
                  <div className="diff-col">
                    <span className="diff-label">You entered</span>
                    <span className="diff-value">{String(f.declared)}</span>
                  </div>
                  <span className="diff-sep" aria-hidden="true" />
                  <div className="diff-col is-evidence">
                    <span className="diff-label">Evidence shows</span>
                    <span className="diff-value">{String(f.in_evidence)}</span>
                  </div>
                </div>

                {f.note && <p className="finding-note">{f.note}</p>}
              </article>
            );
          })}
        </div>

        <footer className="actionbar">
          <span className="actionbar-note">{form.applicant.full_name}</span>
          <button className="btn btn-primary" onClick={() => navigate(`/apply/${id}`)}>
            Return to form and correct
            <ArrowRightIcon size={15} />
          </button>
        </footer>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Assessment result</h1>
          <p className="page-sub">
            Every declared value was corroborated by its evidence, so the submission was scored.
          </p>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Applicant</dt>
            <dd>{form.applicant.full_name}</dd>
          </div>
          <div>
            <dt>Entity</dt>
            <dd>{form.licensee || "—"}</dd>
          </div>
          <div>
            <dt>Position applied for</dt>
            <dd>{form.applicant.proposed_role || "—"}</dd>
          </div>
        </dl>
      </header>

      <ReportView form={form} authentication={authResult} scoreResult={scoreResult!} />

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          <ArrowLeftIcon size={15} />
          Back to start
        </button>
      </footer>
    </div>
  );
}

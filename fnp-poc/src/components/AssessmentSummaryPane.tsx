import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InfoIcon,
  XIcon,
} from "./icons";
import { displaySection } from "../domain/sectionLabels";
import type { FinalAssessment } from "../domain/finalAssessment";

const VERDICT_TONE: Record<string, string> = {
  APPROVE: "low",
  CONDITIONAL: "warning",
  REFER: "serious",
  REJECT: "critical",
};

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Empty({ applicantName }: { applicantName: string }) {
  return (
    <div className="pane-empty">
      <InfoIcon size={20} />
      <p>
        <strong>No assessment summary yet.</strong>
      </p>
      <p>
        The narrative assessment for {applicantName} has not been generated. It is produced after
        scoring completes, and appears here once the engine returns it.
      </p>
    </div>
  );
}

export default function AssessmentSummaryPane({
  assessment,
  applicantName,
  onClose,
}: {
  assessment: FinalAssessment | null;
  applicantName: string;
  onClose: () => void;
}) {
  // Escape closes the pane, as it would any slide-over, and the page behind it stays put.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const determination = assessment?.determination;

  // Rendered at the document root: the pane is a modal layer, and printing it as the PDF means
  // hiding everything else under <body>, which only works if it is a sibling of the app root.
  return createPortal(
    <div className="pane-overlay" role="presentation" onClick={onClose}>
      <aside
        className="pane"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assessment-pane-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pane-head">
          <div className="pane-head-text">
            <h2 id="assessment-pane-title">Assessment summary</h2>
            <p className="pane-sub">{applicantName}</p>
          </div>
          <div className="pane-head-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => window.print()}
              disabled={!assessment}
              title={
                assessment
                  ? "Opens the print dialog — choose Save as PDF"
                  : "Nothing to download yet"
              }
            >
              <DownloadIcon size={14} />
              Download as PDF
            </button>
            <button className="pane-close" onClick={onClose} aria-label="Close assessment summary">
              <XIcon size={16} />
            </button>
          </div>
        </header>

        <div className="pane-body">
          {!assessment || !determination ? (
            <Empty applicantName={applicantName} />
          ) : (
            <>
              <section className="pane-section">
                <div className="pane-verdict">
                  <span className={`chip chip-${VERDICT_TONE[determination.verdict] ?? "neutral"}`}>
                    {determination.verdict}
                  </span>
                  <span className="pane-verdict-reco">{determination.recommendation}</span>
                </div>
                <dl className="pane-stats">
                  <div>
                    <dt>Risk score</dt>
                    <dd>{determination.risk_score}</dd>
                  </div>
                  <div>
                    <dt>Band</dt>
                    <dd>{determination.risk_band}</dd>
                  </div>
                  <div>
                    <dt>Weighted risk</dt>
                    <dd>{determination.weighted_risk}</dd>
                  </div>
                  <div>
                    <dt>Knock-out</dt>
                    <dd>{determination.knock_out_triggered ? "Triggered" : "None"}</dd>
                  </div>
                </dl>
              </section>

              <section className="pane-section">
                <h3>Executive summary</h3>
                <p className="pane-prose">{assessment.executive_summary}</p>
              </section>

              <section className="pane-section">
                <h3>
                  Concerns and proposed conditions
                  <span className="pane-count">{assessment.concerns.length}</span>
                </h3>
                {assessment.concerns.map((c) => (
                  <article className="pane-concern" key={c.condition_id}>
                    <div className="pane-concern-head">
                      <span className="qid">{c.qid}</span>
                      <span className="chip chip-warning">{c.severity}</span>
                      <span className="pane-concern-type">{c.risk_type}</span>
                      <span className="pane-concern-section">{displaySection(c.section)}</span>
                    </div>
                    <p className="pane-prose">{c.statement}</p>
                    <blockquote className="pane-quote">
                      <span className="pane-quote-text">{c.quote}</span>
                      {c.evidence_url && (
                        <a href={c.evidence_url} target="_blank" rel="noreferrer">
                          View in evidence
                          <ExternalLinkIcon size={11} />
                        </a>
                      )}
                    </blockquote>
                    <div className="pane-condition">
                      <span className="pane-condition-id">{c.condition_id}</span>
                      <p>{c.condition}</p>
                    </div>
                  </article>
                ))}
              </section>

              <section className="pane-section">
                <h3>
                  Strengths<span className="pane-count">{assessment.strengths.length}</span>
                </h3>
                <ul className="pane-list">
                  {assessment.strengths.map((s) => (
                    <li key={s.qid}>
                      <CheckCircleIcon size={14} />
                      <span>
                        <span className="qid">{s.qid}</span> {s.statement}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="pane-section">
                <h3>For the supervisor</h3>
                <ul className="pane-list pane-list-questions">
                  {assessment.for_supervisor.map((q) => (
                    <li key={q}>
                      <AlertTriangleIcon size={14} />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="pane-section">
                <h3>Question outcomes</h3>
                <dl className="pane-qsplit">
                  <div>
                    <dt>Passed</dt>
                    <dd>{assessment.questions.passed}</dd>
                  </div>
                  <div>
                    <dt>Conditional</dt>
                    <dd>{assessment.questions.conditional}</dd>
                  </div>
                  <div>
                    <dt>Not applicable</dt>
                    <dd>{assessment.questions.not_applicable}</dd>
                  </div>
                </dl>
              </section>

              <footer className="pane-meta">
                <span>
                  {assessment.evidence.documents_read} documents read ·{" "}
                  {assessment.evidence.questions_verified} questions verified ·{" "}
                  {assessment.evidence.questions_self_declared} self-declared
                </span>
                <span>
                  Assessment v{assessment.assessment.version} · rules v
                  {assessment.assessment.rules_version} · generated{" "}
                  {formatGeneratedAt(assessment.assessment.generated_at)}
                </span>
                <span className="pane-digest">{assessment.assessment.inputs_digest}</span>
              </footer>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

import { useState } from "react";
import { isCvFlag } from "../domain/cvVerification";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  FileTextIcon,
  InfoIcon,
} from "./icons";
import type { CheckResult, CvFinding, CvVerificationResult } from "../domain/types";

const percent = (value: number) => `${Math.round(value * 100)}%`;

const ASPECT_LABELS: Record<string, string> = {
  qualification: "Qualification",
  experience: "Experience",
  directorships: "Directorships",
  sector_relevance: "Sector relevance",
  seniority_level: "Seniority level",
  career_gaps: "Career gaps",
};

/** What each finding was compared against, per the CV Verification sheet. */
const ASPECT_SOURCES: Record<string, string> = {
  qualification: "Q1 — degree certificate",
  experience: "Q3 — employment letter",
  directorships: "CoI2 — company registry extract",
  sector_relevance: "Proposed role",
  seniority_level: "Proposed role",
  career_gaps: "CV timeline",
};

const VERDICT_LABELS: Record<string, string> = {
  CONSISTENT: "Consistent",
  EVIDENCE_CONFLICT: "Evidence conflict",
  NO_CONCERN: "No concern",
  SUITABILITY_FLAG: "Suitability flag",
};

function aspectLabel(aspect: string) {
  return ASPECT_LABELS[aspect] ?? aspect.replaceAll("_", " ");
}

function FindingRow({ finding }: { finding: CvFinding }) {
  const flagged = isCvFlag(finding);
  return (
    <li className={`cv-finding${flagged ? " is-flagged" : ""}`}>
      <span className="cv-finding-icon">
        {flagged ? <AlertTriangleIcon size={14} /> : <CheckCircleIcon size={14} />}
      </span>
      <div className="cv-finding-body">
        <div className="cv-finding-head">
          <span className="cv-finding-aspect">{aspectLabel(finding.aspect)}</span>
          <span className={`chip chip-${flagged ? "warning" : "low"}`}>
            {VERDICT_LABELS[finding.verdict] ?? finding.verdict}
          </span>
          <span className="cv-finding-source">{ASPECT_SOURCES[finding.aspect] ?? ""}</span>
          <span className="check-confidence">
            <span className="confidence-track">
              <span
                className="confidence-fill"
                style={{ width: `${finding.confidence * 100}%` }}
              />
            </span>
            {percent(finding.confidence)}
          </span>
        </div>
        <p className="check-note">{finding.detail}</p>
      </div>
    </li>
  );
}

function GateCheckRow({ check }: { check: CheckResult }) {
  return (
    <li className="check check-good">
      <span className="check-icon">
        <CheckCircleIcon size={14} />
      </span>
      <div className="check-body">
        <div className="check-head">
          <span className="check-label">{check.label}</span>
          <span className="check-confidence">
            <span className="confidence-track">
              <span className="confidence-fill" style={{ width: `${check.confidence * 100}%` }} />
            </span>
            {percent(check.confidence)}
          </span>
        </div>
        <p className="check-note">{check.note}</p>
      </div>
    </li>
  );
}

export default function CvVerificationCard({ result }: { result: CvVerificationResult }) {
  const [open, setOpen] = useState(result.flagCount > 0);

  if (result.status === "not_submitted") {
    return (
      <section className="card section">
        <div className="section-head section-head-static">
          <span className="section-title">Curriculum vitae</span>
          <span className="section-flag">
            <AlertTriangleIcon size={12} />
            Not submitted
          </span>
        </div>
        <div className="section-body cv-body">
          <p className="auth-summary">
            No CV was attached, so the consistency and suitability analysis could not run.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="card section">
      <div className="section-head section-head-static">
        <span className="section-title">Curriculum vitae</span>
        {result.flagCount > 0 ? (
          <span className="section-flag">
            <AlertTriangleIcon size={12} />
            {result.flagCount} finding{result.flagCount > 1 ? "s" : ""} for review
          </span>
        ) : (
          <span className="section-count">No findings</span>
        )}
        <span className="section-count">Supplementary</span>
      </div>

      <div className="section-body cv-body">
        <p className="cv-scope">
          <InfoIcon size={14} />
          <span>
            Checked against the qualification, experience and directorships the primary evidence
            established.
          </span>
        </p>

        <div className="cv-group">
          <h3 className="cv-group-title">Consistency with authenticated evidence</h3>
          <ul className="cv-finding-list">
            {result.consistencyFindings.map((f) => (
              <FindingRow key={f.aspect} finding={f} />
            ))}
          </ul>
        </div>

        <div className="cv-group">
          <h3 className="cv-group-title">Suitability for the proposed role</h3>
          <ul className="cv-finding-list">
            {result.suitabilityFindings.map((f) => (
              <FindingRow key={f.aspect} finding={f} />
            ))}
          </ul>
        </div>

        <div className="cv-gate">
          <button
            className="cv-gate-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="auth-chevron">
              <ChevronDownIcon size={15} />
            </span>
            <FileTextIcon size={14} />
            Document checks ({result.gateChecks.length})
          </button>
          {open && (
            <ul className="check-list">
              {result.gateChecks.map((c) => (
                <GateCheckRow key={c.name} check={c} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

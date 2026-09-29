import { useState } from "react";
import ScoreGauge from "./ScoreGauge";
import RiskMeter from "./RiskMeter";
import { allQuestions } from "../domain/authentication";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  InfoIcon,
} from "./icons";
import { displaySection } from "../domain/sectionLabels";
import type {
  AuthenticationOutcome,
  Band,
  ScoreResult,
  SectionScoreLine,
} from "../domain/types";

const BAND_ICON = {
  Low: CheckCircleIcon,
  Moderate: InfoIcon,
  Elevated: AlertTriangleIcon,
  High: AlertOctagonIcon,
} as const;

function bandTone(band: Band): string {
  return band.toLowerCase();
}

interface SectionTotal {
  section: string;
  weight: number;
  risk: number;
  lines: SectionScoreLine[];
}

function sectionTotals(scoreResult: ScoreResult): SectionTotal[] {
  const totals = new Map<string, SectionTotal>();
  for (const line of scoreResult.lines) {
    const entry = totals.get(line.section) ?? {
      section: line.section,
      weight: 0,
      risk: 0,
      lines: [],
    };
    entry.weight += line.questionWeight;
    entry.risk += line.weightedRisk;
    entry.lines.push(line);
    totals.set(line.section, entry);
  }
  return [...totals.values()].sort((a, b) => b.risk - a.risk || b.weight - a.weight);
}

/** Outcome cell, shared by every question row. */
function OutcomeTag({ line }: { line: SectionScoreLine }) {
  if (line.answer === "N/A") return <span className="chip chip-neutral">Not applicable</span>;
  if (line.riskFlag)
    return (
      <span className="chip chip-critical">
        <AlertTriangleIcon size={13} />
        Risk
      </span>
    );
  return (
    <span className="chip chip-low">
      <CheckCircleIcon size={13} />
      Clear
    </span>
  );
}

/** A section's contribution, expanding to the questions that produced it. */
function SectionRow({ total }: { total: SectionTotal }) {
  const [open, setOpen] = useState(false);
  const bodyId = `risk-${total.section.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <div className={`sbar-group${open ? " is-open" : ""}`}>
      <button
        className="sbar-row"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sbar-chevron">
          <ChevronDownIcon size={14} />
        </span>
        <span className="sbar-label">{displaySection(total.section)}</span>
        <span className="sbar-track">
          <span
            className="sbar-fill"
            style={{ width: `${(total.risk / total.weight) * 100}%` }}
          />
        </span>
        <span className="sbar-value">
          {total.risk.toFixed(1)}
          <span className="sbar-denom"> / {total.weight}</span>
        </span>
      </button>

      {open && (
        <div className="sbar-detail" id={bodyId}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Answer</th>
                <th scope="col" className="num">
                  Weight
                </th>
                <th scope="col">Outcome</th>
                <th scope="col" className="num">
                  Contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {total.lines.map((l) => (
                <tr key={l.qid} className={l.knockOutTriggered ? "row-knockout" : undefined}>
                  <td>
                    <span className="qid">{l.qid}</span>
                  </td>
                  <td>
                    <span
                      className={`answer-tag answer-${l.answer.toLowerCase().replace("/", "")}`}
                    >
                      {l.answer}
                    </span>
                  </td>
                  <td className="num">{l.applicableWeight}</td>
                  <td>
                    <OutcomeTag line={l} />
                  </td>
                  <td className="num strong">{l.weightedRisk.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReportView({
  authentication,
  scoreResult,
}: {
  authentication: AuthenticationOutcome;
  scoreResult: ScoreResult;
}) {
  const cautions = allQuestions(authentication).filter((q) =>
    q.checks.some((c) => c.status === "caution")
  );
  const sections = sectionTotals(scoreResult);
  const BandIcon = BAND_ICON[scoreResult.band];

  return (
    <div className="report">
      <section className="verdict card">
        <div className="verdict-score">
          <ScoreGauge score={scoreResult.riskScore100} band={scoreResult.band} />
          <RiskMeter score={scoreResult.riskScore100} band={scoreResult.band} />
        </div>

        <div className="verdict-body">
          <span className={`chip chip-${bandTone(scoreResult.band)}`}>
            <BandIcon size={14} />
            {scoreResult.band} risk
          </span>
          <h2 className="verdict-reco">{scoreResult.recommendation}</h2>
          <dl className="verdict-stats">
            <div>
              <dt>Weighted risk</dt>
              <dd>{scoreResult.totalWeightedRisk.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Applicable weight</dt>
              <dd>{scoreResult.totalApplicableWeight}</dd>
            </div>
            <div>
              <dt>Normalised</dt>
              <dd>{scoreResult.normalisedRiskScore.toFixed(3)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {scoreResult.knockOutTriggered && (
        <div className="notice notice-critical">
          <AlertOctagonIcon size={17} />
          <div>
            <strong>Knock-out triggered.</strong> {scoreResult.knockOutReason} The case is referred
            regardless of the weighted score.
          </div>
        </div>
      )}

      {cautions.length > 0 && (
        <div className="notice notice-info">
          <InfoIcon size={17} />
          <div>
            <strong>
              {cautions.length} question{cautions.length > 1 ? "s" : ""} authenticated at reduced
              confidence
            </strong>{" "}
            ({cautions.map((q) => q.qid).join(", ")}). Scoring treats them as authenticated — see
            the authentication report for why.
          </div>
        </div>
      )}

      <section className="card">
        <header className="card-head">
          <h2>Where the risk comes from</h2>
          <p className="card-sub">
            Weighted risk points contributed by each section, against that section's maximum.
            Select a section to see the questions behind it.
          </p>
        </header>

        <div className="sectionbars">
          {sections.map((s) => (
            <SectionRow key={s.section} total={s} />
          ))}

          <div className="sbar-total">
            <span className="sbar-total-label">Total</span>
            <span className="sbar-total-value">
              {scoreResult.totalWeightedRisk.toFixed(1)}
              <span className="sbar-denom"> / {scoreResult.totalApplicableWeight}</span>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

import ScoreGauge from "./ScoreGauge";
import { allQuestions } from "../domain/authentication";
import { AlertOctagonIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon } from "./icons";
import { displaySection } from "../domain/sectionLabels";
import type { ApplicationForm, AuthenticationOutcome, Band, ScoreResult } from "../domain/types";

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
}

function sectionTotals(scoreResult: ScoreResult): SectionTotal[] {
  const totals = new Map<string, SectionTotal>();
  for (const line of scoreResult.lines) {
    const entry = totals.get(line.section) ?? { section: line.section, weight: 0, risk: 0 };
    entry.weight += line.questionWeight;
    entry.risk += line.weightedRisk;
    totals.set(line.section, entry);
  }
  return [...totals.values()].sort((a, b) => b.risk - a.risk || b.weight - a.weight);
}

export default function ReportView({
  form,
  authentication,
  scoreResult,
}: {
  form: ApplicationForm;
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
        <ScoreGauge score={scoreResult.riskScore100} band={scoreResult.band} />

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
          </p>
        </header>

        <div className="sectionbars">
          {sections.map((s) => (
            <div className="sbar-row" key={s.section} tabIndex={0}>
              <span className="sbar-label">{displaySection(s.section)}</span>
              <span className="sbar-track">
                <span className="sbar-fill" style={{ width: `${(s.risk / s.weight) * 100}%` }} />
              </span>
              <span className="sbar-value">
                {s.risk.toFixed(1)}
                <span className="sbar-denom"> / {s.weight}</span>
              </span>
              <span className="sbar-tip" role="tooltip">
                {displaySection(s.section)}: {s.risk.toFixed(1)} of {s.weight} risk points
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Question breakdown</h2>
          <p className="card-sub">
            Every scored question, its applicable weight and what it contributed.
          </p>
        </header>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Section</th>
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
              {scoreResult.lines.map((l) => (
                <tr key={l.qid} className={l.knockOutTriggered ? "row-knockout" : undefined}>
                  <td>
                    <span className="qid">{l.qid}</span>
                  </td>
                  <td className="cell-muted">{displaySection(l.section)}</td>
                  <td>
                    <span className={`answer-tag answer-${l.answer.toLowerCase().replace("/", "")}`}>
                      {l.answer}
                    </span>
                  </td>
                  <td className="num">{l.applicableWeight}</td>
                  <td>
                    {l.answer === "N/A" ? (
                      <span className="chip chip-neutral">Not applicable</span>
                    ) : l.riskFlag ? (
                      <span className="chip chip-critical">
                        <AlertTriangleIcon size={13} />
                        Risk
                      </span>
                    ) : (
                      <span className="chip chip-low">
                        <CheckCircleIcon size={13} />
                        Clear
                      </span>
                    )}
                  </td>
                  <td className="num strong">{l.weightedRisk.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className="num">{scoreResult.totalApplicableWeight}</td>
                <td />
                <td className="num strong">{scoreResult.totalWeightedRisk.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <details className="card json-card">
        <summary>Report JSON — what the engine hands the front end</summary>
        <pre>
          {JSON.stringify(
            {
              applicationId: form.application_id,
              applicant: form.applicant.full_name,
              entity: form.licensee,
              positionAppliedFor: form.applicant.proposed_role,
              score: Number(scoreResult.riskScore100.toFixed(1)),
              band: scoreResult.band,
              knockOutTriggered: scoreResult.knockOutTriggered,
              recommendation: scoreResult.recommendation,
              generatedAt: new Date().toISOString(),
            },
            null,
            2
          )}
        </pre>
      </details>
    </div>
  );
}

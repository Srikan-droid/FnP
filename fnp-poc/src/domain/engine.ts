import { QUESTIONS, QUESTION_BY_QID } from "./questions";
import { bandFor } from "./bands";
import type {
  Answer,
  ApplicationForm,
  AuthenticationFieldResult,
  AuthenticationResult,
  FieldExpectation,
  ScoreResult,
  SectionScoreLine,
} from "./types";

// Verdicts that must send the case back to the filer instead of proceeding to scoring.
const BLOCKING_VERDICTS = new Set(["MISMATCH", "CONTRADICTION", "EVIDENCE_MISSING", "UNVERIFIABLE"]);

export function authenticate(
  applicationId: string,
  expectedFields: FieldExpectation[]
): AuthenticationResult {
  const fields: AuthenticationFieldResult[] = expectedFields;
  const blockingFields = fields.filter((f) => BLOCKING_VERDICTS.has(f.expected));
  return {
    applicationId,
    isClean: blockingFields.length === 0,
    fields,
    blockingFields,
  };
}

// T2 ("executive responsibility") is only a risk question for executive appointments. For a
// non-executive director, "No" is the expected, risk-free answer — the scoring model (per
// Notes and Assumptions) treats that as N/A rather than charging it as a Positive-polarity "No".
const appointedPosition = (form: ApplicationForm) =>
  form.responses.find((r) => r.qid === "T1")?.declared_values.appointed_position;

export function score(form: ApplicationForm): ScoreResult {
  const lines: SectionScoreLine[] = [];
  let totalApplicableWeight = 0;
  let totalWeightedRisk = 0;
  let knockOutTriggered = false;
  let knockOutReason: string | undefined;
  const nonExecutive = appointedPosition(form) === "Non-Executive Director";

  for (const response of form.responses) {
    const def = QUESTION_BY_QID[response.qid];
    if (!def) continue;

    const answer: Answer = def.qid === "T2" && nonExecutive ? "N/A" : response.answer;
    const applicableWeight = answer === "N/A" ? 0 : def.questionWeight;

    // Risk flag: for Positive-polarity questions, "No" carries risk; for Negative-polarity, "Yes" does.
    let riskFlag: 0 | 1 = 0;
    if (answer !== "N/A") {
      riskFlag = def.polarity === "Positive" ? (answer === "No" ? 1 : 0) : answer === "Yes" ? 1 : 0;
    }

    const weightedRisk = applicableWeight * riskFlag;
    const isThisKnockOut = def.isKnockOut && riskFlag === 1;
    if (isThisKnockOut) {
      knockOutTriggered = true;
      knockOutReason = `${def.qid}: ${def.question}`;
    }

    totalApplicableWeight += applicableWeight;
    totalWeightedRisk += weightedRisk;

    lines.push({
      qid: def.qid,
      section: def.section,
      question: def.question,
      answer,
      polarity: def.polarity,
      questionWeight: def.questionWeight,
      riskFlag,
      applicableWeight,
      weightedRisk,
      isKnockOut: def.isKnockOut,
      knockOutTriggered: isThisKnockOut,
    });
  }

  const normalisedRiskScore = totalApplicableWeight > 0 ? totalWeightedRisk / totalApplicableWeight : 0;
  const riskScore100 = normalisedRiskScore * 100;
  const { band, action } = bandFor(normalisedRiskScore);

  return {
    applicationId: form.application_id,
    lines,
    totalApplicableWeight,
    totalWeightedRisk,
    normalisedRiskScore,
    riskScore100,
    band,
    knockOutTriggered,
    knockOutReason,
    recommendation: knockOutTriggered
      ? "Recommend rejection — refer for supervisory review (knock-out triggered)"
      : action,
  };
}

export function questionCount() {
  return QUESTIONS.length;
}

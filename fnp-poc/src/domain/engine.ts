import { QUESTIONS, QUESTION_BY_QID } from "./questions";
import { bandFor } from "./bands";
import type { Answer, ApplicationForm, ScoreResult, SectionScoreLine } from "./types";

/**
 * `weights` lets a caller score against a weight set other than the published model — the
 * reviewer can reconfigure weights, and an assessment is scored against whatever was in force
 * when it was submitted rather than whatever is current.
 */
export function score(form: ApplicationForm, weights?: Record<string, number>): ScoreResult {
  const lines: SectionScoreLine[] = [];
  let totalApplicableWeight = 0;
  let totalWeightedRisk = 0;
  let knockOutTriggered = false;
  let knockOutReason: string | undefined;

  for (const response of form.responses) {
    const def = QUESTION_BY_QID[response.qid];
    if (!def) continue;

    const answer: Answer = response.answer;
    const questionWeight = weights?.[def.qid] ?? def.questionWeight;
    const applicableWeight = answer === "N/A" ? 0 : questionWeight;

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
      questionWeight,
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

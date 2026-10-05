import type { CaseStage } from "../state/caseStore";

/**
 * How each stage reads in the two queues. `tone` maps onto the existing chip palette: blue for
 * work sitting with someone, amber when it is waiting on the applicant, green once accepted,
 * red once rejected.
 */
export const STAGE_LABELS: Record<CaseStage, { reviewer: string; applicant: string; tone: string }> =
  {
    NOT_SUBMITTED: { reviewer: "Not submitted", applicant: "Draft saved", tone: "neutral" },
    AUTH_RUNNING: {
      reviewer: "Authentication running",
      applicant: "Authentication pending",
      tone: "info",
    },
    REVIEW_PENDING: { reviewer: "Review pending", applicant: "With the reviewer", tone: "critical" },
    AWAITING_APPLICANT: {
      reviewer: "Awaiting applicant",
      applicant: "Authentication pending — resubmit",
      tone: "warning",
    },
    SCORING: { reviewer: "Scoring in progress", applicant: "Scoring in progress", tone: "info" },
    DECISION_PENDING: { reviewer: "Decision pending", applicant: "Awaiting decision", tone: "serious" },
    ACCEPTED: { reviewer: "Accepted", applicant: "Accepted", tone: "low" },
    REJECTED: { reviewer: "Rejected", applicant: "Rejected", tone: "critical" },
  };

/** Cases needing the reviewer's hands come first, then work in flight, then settled ones. */
const ORDER: CaseStage[] = [
  "REVIEW_PENDING",
  "DECISION_PENDING",
  "AWAITING_APPLICANT",
  "SCORING",
  "AUTH_RUNNING",
  "ACCEPTED",
  "REJECTED",
  "NOT_SUBMITTED",
];

export function queueRank(stage: CaseStage): number {
  const index = ORDER.indexOf(stage);
  return index === -1 ? ORDER.length : index;
}

/** True when the stage is one the reviewer has to act on. */
export function needsReviewer(stage: CaseStage): boolean {
  return stage === "REVIEW_PENDING" || stage === "DECISION_PENDING";
}

/**
 * The case state both portals share. The applicant submits, the AI pass flags questions, the
 * reviewer rules on each flagged question, and the case either moves to scoring or goes back to
 * the applicant for new evidence. Everything lives in localStorage so the two portals stay in
 * step across page loads and across the two sign-ins.
 */

export type CaseStage =
  | "NOT_SUBMITTED"
  /** The simulated AI pass is still running. */
  | "AUTH_RUNNING"
  /** The AI flagged questions the reviewer has not ruled on yet. */
  | "REVIEW_PENDING"
  /** The reviewer rejected at least one answer; the applicant owes new evidence. */
  | "AWAITING_APPLICANT"
  | "SCORING"
  /** Scored, waiting on the reviewer's accept or reject. */
  | "DECISION_PENDING"
  | "ACCEPTED"
  | "REJECTED";

export type RulingVerdict = "accepted" | "rejected";

export interface QuestionRuling {
  verdict: RulingVerdict;
  comment: string;
  at: number;
}

export interface CaseDecision {
  verdict: RulingVerdict;
  remarks: string;
  at: number;
}

export interface CaseRecord {
  submittedAt: number | null;
  /** Reviewer rulings on the questions the AI flagged, keyed by qid. */
  rulings: Record<string, QuestionRuling>;
  /**
   * Set when the applicant resubmits after a rejection. The POC has no backend to re-run, so a
   * resubmission is taken to carry correct evidence and the re-run comes back clean.
   */
  resubmittedAt: number | null;
  decision: CaseDecision | null;
  /**
   * The question weights in force when this was submitted. Absent on cases submitted before the
   * reviewer changed anything, which are scored against the published model.
   */
  weightSnapshot?: Record<string, number>;
  /**
   * Demo affordance only. Scoring lasts a few seconds, so a seeded case would drop out of
   * "Scoring in progress" before anyone saw it. A pinned stage holds the case there until the
   * reviewer or the applicant does something to it, at which point it clears and the case
   * rejoins the real transitions.
   */
  pinnedStage?: CaseStage;
}

// Simulated engine timings.
const AUTH_MS = 6000;
const SCORING_MS = 8000;

const EMPTY: CaseRecord = {
  submittedAt: null,
  rulings: {},
  resubmittedAt: null,
  decision: null,
};

const storageKey = (assessmentId: string) => `fnp-case-v1-${assessmentId}`;

export function readCase(assessmentId: string): CaseRecord {
  try {
    const raw = localStorage.getItem(storageKey(assessmentId));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<CaseRecord>;
    return { ...EMPTY, ...parsed, rulings: parsed.rulings ?? {} };
  } catch {
    return { ...EMPTY };
  }
}

function writeCase(assessmentId: string, record: CaseRecord): void {
  try {
    localStorage.setItem(storageKey(assessmentId), JSON.stringify(record));
  } catch {
    // A full or blocked store only costs the demo its continuity, so fail quietly.
  }
}

function mutate(assessmentId: string, change: (record: CaseRecord) => CaseRecord): void {
  writeCase(assessmentId, change(readCase(assessmentId)));
}

export function recordSubmission(
  assessmentId: string,
  weightSnapshot?: Record<string, number>,
  at: number = Date.now()
): void {
  mutate(assessmentId, () => ({ ...EMPTY, submittedAt: at, weightSnapshot }));
}

/** Seeds a case wholesale. Used only to populate the demo queue. */
export function seedCase(assessmentId: string, record: Partial<CaseRecord>): void {
  writeCase(assessmentId, { ...EMPTY, ...record });
}

export function clearCase(assessmentId: string): void {
  try {
    localStorage.removeItem(storageKey(assessmentId));
  } catch {
    // ignored
  }
}

export function ruleOnQuestion(
  assessmentId: string,
  qid: string,
  verdict: RulingVerdict,
  comment: string,
  at: number = Date.now()
): void {
  mutate(assessmentId, (record) => ({
    ...record,
    pinnedStage: undefined,
    rulings: { ...record.rulings, [qid]: { verdict, comment, at } },
  }));
}

export function clearRuling(assessmentId: string, qid: string): void {
  mutate(assessmentId, (record) => {
    const rulings = { ...record.rulings };
    delete rulings[qid];
    return { ...record, rulings };
  });
}

/**
 * The applicant has attached new evidence for the rejected questions. The reviewer's rulings are
 * cleared so the case presents as a fresh pass rather than carrying the old rejections.
 */
export function recordResubmission(assessmentId: string, at: number = Date.now()): void {
  mutate(assessmentId, (record) => ({
    ...record,
    pinnedStage: undefined,
    rulings: {},
    resubmittedAt: at,
  }));
}

export function recordDecision(
  assessmentId: string,
  verdict: RulingVerdict,
  remarks: string,
  at: number = Date.now()
): void {
  mutate(assessmentId, (record) => ({
    ...record,
    pinnedStage: undefined,
    decision: { verdict, remarks, at },
  }));
}

/** When scoring started, or null if the case has not reached scoring. */
function scoringStartedAt(record: CaseRecord, flagged: string[]): number | null {
  if (record.submittedAt === null) return null;

  // A resubmission is assumed clean, so it runs the AI pass again and then scores.
  if (record.resubmittedAt !== null) return record.resubmittedAt + AUTH_MS;

  const authDoneAt = record.submittedAt + AUTH_MS;
  if (flagged.length === 0) return authDoneAt;

  const rulings = flagged.map((qid) => record.rulings[qid]);
  if (rulings.some((r) => !r || r.verdict === "rejected")) return null;
  // Every flag was accepted; scoring begins with the last acceptance.
  return Math.max(authDoneAt, ...rulings.map((r) => r!.at));
}

/**
 * `flagged` is the list of qids the AI could not authenticate, which the caller derives from the
 * authentication outcome. Keeping it a parameter leaves this store independent of the engine.
 */
export function stageFor(
  assessmentId: string,
  flagged: string[],
  now: number = Date.now()
): CaseStage {
  const record = readCase(assessmentId);
  if (record.submittedAt === null) return "NOT_SUBMITTED";
  if (record.decision) return record.decision.verdict === "accepted" ? "ACCEPTED" : "REJECTED";
  if (record.pinnedStage) return record.pinnedStage;

  const latestSubmission = record.resubmittedAt ?? record.submittedAt;
  if (now - latestSubmission < AUTH_MS) return "AUTH_RUNNING";

  if (record.resubmittedAt === null && flagged.length > 0) {
    const rulings = flagged.map((qid) => record.rulings[qid]);
    if (rulings.some((r) => r?.verdict === "rejected")) return "AWAITING_APPLICANT";
    if (rulings.some((r) => !r)) return "REVIEW_PENDING";
  }

  const startedAt = scoringStartedAt(record, flagged);
  if (startedAt === null) return "REVIEW_PENDING";
  return now - startedAt < SCORING_MS ? "SCORING" : "DECISION_PENDING";
}

/**
 * True when any of these cases could still be mid-authentication or mid-scoring. Derived from
 * the stored timestamps alone, so a page can decide whether to keep a clock running without
 * first needing a rendered stage.
 */
export function anyCaseInFlight(assessmentIds: string[], now: number = Date.now()): boolean {
  const window = AUTH_MS + SCORING_MS;
  return assessmentIds.some((id) => {
    const record = readCase(id);
    if (record.submittedAt === null || record.decision) return false;
    const latest = Math.max(record.submittedAt, record.resubmittedAt ?? 0);
    const lastRuling = Object.values(record.rulings).reduce((max, r) => Math.max(max, r.at), 0);
    return now - Math.max(latest, lastRuling) < window;
  });
}

/** True once scoring has finished, which is what gates the scoring report. */
export function isScored(stage: CaseStage): boolean {
  return stage === "DECISION_PENDING" || stage === "ACCEPTED" || stage === "REJECTED";
}

/** True once the AI pass has returned, which is what gates the authentication report. */
export function isAuthenticationDone(stage: CaseStage): boolean {
  return stage !== "NOT_SUBMITTED" && stage !== "AUTH_RUNNING";
}

/** Fraction of the current simulated run that has elapsed, for the progress bar. */
export function stageProgress(
  assessmentId: string,
  flagged: string[],
  now: number = Date.now()
): number {
  const record = readCase(assessmentId);
  if (record.submittedAt === null) return 0;

  const latestSubmission = record.resubmittedAt ?? record.submittedAt;
  if (now - latestSubmission < AUTH_MS) {
    return Math.min(1, (now - latestSubmission) / AUTH_MS);
  }

  const startedAt = scoringStartedAt(record, flagged);
  if (startedAt === null) return 1;
  return Math.min(1, (now - startedAt) / SCORING_MS);
}

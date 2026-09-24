export type SubmissionStatus =
  | "NOT_SUBMITTED"
  | "AUTH_PENDING"
  | "AUTH_ISSUES"
  | "SCORING"
  | "COMPLETED";

/** Simulated engine timings — authentication runs first, scoring only after it comes back clean. */
const AUTH_MS = 6000;
const SCORING_MS = 8000;

const storageKey = (assessmentId: string) => `fnp-submission-${assessmentId}`;

export function submittedAtFor(assessmentId: string): number | null {
  const raw = localStorage.getItem(storageKey(assessmentId));
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function recordSubmission(assessmentId: string): void {
  localStorage.setItem(storageKey(assessmentId), String(Date.now()));
}

export function clearSubmission(assessmentId: string): void {
  localStorage.removeItem(storageKey(assessmentId));
}

/**
 * Status is derived from how long ago the filer submitted, so it keeps advancing while they are
 * off reading the authentication report rather than resetting every time the page mounts.
 */
export function statusFor(
  assessmentId: string,
  isClean: boolean,
  now: number = Date.now()
): SubmissionStatus {
  const submittedAt = submittedAtFor(assessmentId);
  if (submittedAt === null) return "NOT_SUBMITTED";

  const elapsed = now - submittedAt;
  if (elapsed < AUTH_MS) return "AUTH_PENDING";
  if (!isClean) return "AUTH_ISSUES";
  return elapsed < AUTH_MS + SCORING_MS ? "SCORING" : "COMPLETED";
}

export function isAuthenticationDone(status: SubmissionStatus): boolean {
  return status === "AUTH_ISSUES" || status === "SCORING" || status === "COMPLETED";
}

/** Fraction of the whole pipeline that has elapsed, for the pending progress bar. */
export function pipelineProgress(assessmentId: string, now: number = Date.now()): number {
  const submittedAt = submittedAtFor(assessmentId);
  if (submittedAt === null) return 0;
  return Math.min(1, (now - submittedAt) / (AUTH_MS + SCORING_MS));
}

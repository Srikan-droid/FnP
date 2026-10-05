import { readCase, seedCase } from "./caseStore";
import { REVIEWABLE_ASSIGNMENTS } from "../data/assignments";

const SEED_MARKER = "fnp-seeded-v1";
const HOUR = 60 * 60 * 1000;

/**
 * Gives the reviewer a populated queue on first run, spread across the statuses the queue can
 * show. The stages are not written directly: each case is seeded with the facts that produce
 * the stage, so the seeded cases behave exactly like ones walked through by hand.
 *
 * APP003 and APP004 are the two whose authentication genuinely fails, so they are the only ones
 * that can carry a review or a rejection.
 */
export function seedDemoCases(now: number = Date.now()): void {
  try {
    if (localStorage.getItem(SEED_MARKER)) return;
  } catch {
    return;
  }

  const byApplicant = new Map(REVIEWABLE_ASSIGNMENTS.map((a) => [a.applicantId, a.id]));
  const id = (applicantId: string) => byApplicant.get(applicantId);

  // APP001 — authenticated clean, scored, and already accepted by the reviewer.
  const app001 = id("APP001");
  if (app001) {
    seedCase(app001, {
      submittedAt: now - 6 * HOUR,
      decision: {
        verdict: "accepted",
        remarks:
          "Moderate risk driven by an external directorship and a part-time commitment. Approved subject to the conflict and attendance conditions.",
        at: now - 2 * HOUR,
      },
    });
  }

  // APP002 — clean and scored, waiting on the reviewer's decision.
  const app002 = id("APP002");
  if (app002) seedCase(app002, { submittedAt: now - 5 * HOUR });

  // APP003 — the AI flagged Q3 and PC19 and nobody has ruled on them yet.
  const app003 = id("APP003");
  if (app003) seedCase(app003, { submittedAt: now - 3 * HOUR });

  // APP004 — the AI flagged PC1, and the reviewer rejected it, so the applicant owes evidence.
  const app004 = id("APP004");
  if (app004) {
    seedCase(app004, {
      submittedAt: now - 4 * HOUR,
      rulings: {
        PC1: {
          verdict: "rejected",
          comment:
            "The clearance certificate records a 2013 conviction under section 34 of the Companies Act. Declaring No is not supported. Amend the answer or provide a court order confirming the conviction was expunged.",
          at: now - 90 * 60 * 1000,
        },
      },
    });
  }

  // APP005 — clean, and held in scoring so that stage is visible in the queue.
  const app005 = id("APP005");
  if (app005) {
    seedCase(app005, { submittedAt: now - 30 * 60 * 1000, pinnedStage: "SCORING" });
  }

  try {
    localStorage.setItem(SEED_MARKER, String(now));
  } catch {
    // ignored
  }
}

/** True when a case has never been touched, so the demo seed can be re-applied. */
export function isUnseeded(assessmentId: string): boolean {
  const record = readCase(assessmentId);
  return record.submittedAt === null;
}

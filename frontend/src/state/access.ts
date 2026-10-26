/**
 * What the signed-in account may do: a user applies; an admin reviews the cases of their
 * departments and configures those departments' questions; the super user does all of that for
 * every department, and manages accounts and departments in the admin panel. The backend enforces
 * the same rules; these only decide what is offered.
 */
import type { AdminUser, CaseReviewer, SessionUser, Stage } from "../api/types";

/** Submitted and not decided: a case one of its department's admins reviews. */
export const REVIEWABLE: Stage[] = [
  "AUTH_RUNNING",
  "AUTH_FAILED",
  "REVIEW_PENDING",
  "AWAITING_APPLICANT",
  "SCORING",
  "DECISION_PENDING",
];

/** Whether another admin is reviewing the case: this one can read it, not act on it. */
export function heldByOther(reviewer: CaseReviewer | null | undefined, user: SessionUser | null | undefined): boolean {
  return Boolean(reviewer && user && reviewer.email !== user.email);
}

export function isSuperUser(user: SessionUser | null | undefined): boolean {
  return user?.access === "superuser";
}

/** An account's departments in a line, as the admin panel lists them (none for a user). */
export function departmentList(user: Pick<AdminUser, "role" | "departments">): string | null {
  if (user.role === "superuser") return "All departments";
  if (user.role !== "reviewer") return null;
  return user.departments.length ? user.departments.map((d) => d.name).join(", ") : "No department yet";
}

/** The departments a reviewer works on, in words: "All departments" for the super user. */
export function departmentsInWords(user: SessionUser | null | undefined): string {
  if (!user || isSuperUser(user)) return "All departments";
  const departments = user.departments ?? [];
  if (departments.length === 0) return "No department yet";
  if (departments.length === 1) return departments[0].name;
  return `${departments.length} departments`;
}

import { Link, useLocation, useNavigate } from "react-router-dom";
import { useRef } from "react";
import type { ReactNode } from "react";
import { useAssessment, useSession, useSignOut } from "../api/queries";
import { CheckIcon, LogOutIcon } from "./icons";
import ThemeSwitch from "./ThemeSwitch";
import { parseApplyPath, routes } from "../routes";
import type { ApplyStep } from "../routes";
import type { Stage } from "../api/types";
import { useTrackHistoryEntry } from "../state/backNavigation";
import { departmentsInWords } from "../state/access";
import { usePageChange } from "../state/pageChange";

const STEPS = ["Data collection", "Review", "Authentication", "Result"] as const;

/** Where each applicant route sits in the stepper; the form itself is step 0. */
const STEP_INDEX: Record<ApplyStep, number> = {
  review: 1,
  status: 2,
  authentication: 2,
  result: 3,
};

/**
 * How far the application has actually got, as a step index: the steps before it are done, and
 * the step at it is in progress (STEPS.length means every step is done). It follows the case's
 * stage, so opening an earlier page doesn't wind the progress back. Until the case has loaded, or
 * while it is still a draft, the page being shown is the best guide.
 */
function progressIndex(stage: Stage | undefined, viewing: number): number {
  switch (stage) {
    case undefined:
      return viewing;
    case "NOT_SUBMITTED":
      return Math.min(viewing, 1);
    case "AUTH_RUNNING":
    case "AUTH_FAILED":
    case "REVIEW_PENDING":
    case "AWAITING_APPLICANT":
      return 2;
    case "SCORING":
    case "DECISION_PENDING":
      return 3;
    case "ACCEPTED":
    case "REJECTED":
      return STEPS.length;
  }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // Lets a page tell a Back press from a reload or Forward (see state/backNavigation).
  useTrackHistoryEntry();
  // The tab title, and the view and focus moving to a new page (state/pageChange).
  const main = useRef<HTMLElement>(null);
  usePageChange(main);
  const navigate = useNavigate();
  const { data: user } = useSession();
  const signOut = useSignOut();
  const email = user?.email ?? null;

  const isReviewer = pathname.startsWith(routes.reviewer());
  const isPortal = pathname.startsWith(routes.assessments()) || isReviewer;
  const applyRoute = parseApplyPath(pathname);
  const stepIndex = applyRoute ? (applyRoute.step ? STEP_INDEX[applyRoute.step] : 0) : null;
  // Already cached by the page itself, so the header costs no extra request.
  const { data: assessment } = useAssessment(applyRoute?.assignmentId);

  const progress = stepIndex === null ? null : progressIndex(assessment?.stage, stepIndex);

  if (!isPortal && stepIndex === null) {
    return (
      <main className="app-main" ref={main} tabIndex={-1}>
        {children}
      </main>
    );
  }

  const handleSignOut = () => {
    signOut.mutate(undefined, { onSettled: () => navigate(routes.login()) });
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to={isReviewer ? routes.reviewer() : routes.assessments()}>
            <span className="brand-logo" role="img" aria-label="iRIS" />
            <span className="brand-text">
              <span className="brand-title">Fit and Proper Assessment</span>
              <span className="brand-sub">
                {isReviewer
                  ? `Reviewer portal · ${departmentsInWords(user)}`
                  : (assessment?.department.name ?? "Applicant portal")}
              </span>
            </span>
          </Link>

          <div className="topbar-actions">
            <ThemeSwitch />
            {email && (
              <div className="session">
                {/* On a phone only the initials show; the full address is in the tooltip. */}
                <span className="session-avatar" title={email}>
                  {initials(email)}
                </span>
                <span className="session-email">{email}</span>
                <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>
                  <LogOutIcon size={13} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        {stepIndex !== null && progress !== null && !isReviewer && (
          <nav className="stepper" aria-label="Application progress">
            <ol>
              {STEPS.map((label, i) => {
                const state = i < progress ? "is-done" : i === progress ? "is-current" : "is-todo";
                // The page being shown, when it isn't the step in progress (say, an earlier step).
                const viewing = i === stepIndex && i !== progress ? " is-viewing" : "";
                return (
                  <li
                    key={label}
                    className={state + viewing}
                    aria-current={i === stepIndex ? "step" : undefined}
                  >
                    <span className="step-marker">
                      {i < progress ? <CheckIcon size={13} /> : i + 1}
                    </span>
                    <span className="step-label">{label}</span>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </header>
      <main className="app-main" ref={main} tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const first = parts[0]?.[0] ?? local[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase();
}

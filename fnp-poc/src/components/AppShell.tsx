import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import { CheckIcon, LogOutIcon, ShieldCheckIcon } from "./icons";

const STEPS = ["Data collection", "Review", "Authentication", "Result"] as const;

const STEP_BY_STAGE: Record<string, number> = {
  review: 1,
  status: 2,
  authentication: 2,
  result: 3,
};

function readRoute(pathname: string): { assignmentId: string | null; stepIndex: number | null } {
  const match = /^\/apply\/([^/]+)(?:\/(review|status|authentication|result))?\/?$/.exec(pathname);
  if (!match) return { assignmentId: null, stepIndex: null };
  const stage = match[2];
  return { assignmentId: match[1], stepIndex: stage ? STEP_BY_STAGE[stage] : 0 };
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { email, signOut } = useAssessment();

  const isPortal = pathname.startsWith("/assessments");
  const { assignmentId, stepIndex } = readRoute(pathname);
  const assignment = assignmentId ? getAssignment(assignmentId) : undefined;

  if (!isPortal && stepIndex === null) return <main className="app-main">{children}</main>;

  const handleSignOut = () => {
    signOut();
    navigate("/");
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/assessments">
            <span className="brand-mark">
              <ShieldCheckIcon size={18} />
            </span>
            <span className="brand-text">
              <span className="brand-title">Fit and Proper Assessment</span>
              <span className="brand-sub">
                {assignment ? departmentFor(assignment).name : "Applicant portal"}
              </span>
            </span>
          </Link>

          {email && (
            <div className="session">
              <span className="session-avatar">{initials(email)}</span>
              <span className="session-email">{email}</span>
              <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>
                <LogOutIcon size={13} />
                Sign out
              </button>
            </div>
          )}
        </div>

        {stepIndex !== null && (
          <nav className="stepper" aria-label="Application progress">
            <ol>
              {STEPS.map((label, i) => {
                const state = i < stepIndex ? "is-done" : i === stepIndex ? "is-current" : "is-todo";
                return (
                  <li key={label} className={state}>
                    <span className="step-marker">
                      {i < stepIndex ? <CheckIcon size={13} /> : i + 1}
                    </span>
                    <span className="step-label">{label}</span>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </header>
      <main className="app-main">{children}</main>
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

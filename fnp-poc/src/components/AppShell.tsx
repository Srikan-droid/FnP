import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { APPLICANT_PROFILES } from "../data/fixtures";
import { CheckIcon, ShieldCheckIcon } from "./icons";

const STEPS = ["Data collection", "Review", "Assessment", "Result"] as const;

interface RouteInfo {
  applicationId: string | null;
  stepIndex: number | null;
}

function readRoute(pathname: string): RouteInfo {
  const match = /^\/apply\/([^/]+)(?:\/(review|processing|result))?\/?$/.exec(pathname);
  if (!match) return { applicationId: null, stepIndex: null };
  const stage = match[2];
  const stepIndex = stage === "review" ? 1 : stage === "processing" ? 2 : stage === "result" ? 3 : 0;
  return { applicationId: match[1], stepIndex };
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { applicationId, stepIndex } = readRoute(pathname);
  const profile = APPLICANT_PROFILES.find((p) => p.id === applicationId);

  if (stepIndex === null) return <main className="app-main">{children}</main>;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-mark">
              <ShieldCheckIcon size={18} />
            </span>
            <span className="brand-text">
              <span className="brand-title">Fit and Proper Assessment</span>
              <span className="brand-sub">Bank of Namibia</span>
            </span>
          </Link>

          {profile && (
            <div className="session-chip">
              <span className="session-avatar">{initials(profile.name)}</span>
              <span className="session-text">
                <span className="session-name">{profile.name}</span>
                <span className="session-id">{profile.id}</span>
              </span>
            </div>
          )}
        </div>

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
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}

function initials(name: string): string {
  const parts = name.split(" ").filter((p) => p.length > 1 && !p.includes("."));
  const first = parts[0]?.[0] ?? name[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

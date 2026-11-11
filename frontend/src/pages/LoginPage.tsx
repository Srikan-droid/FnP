import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { keys, useSession, useSignIn, useSignOut } from "../api/queries";
import { ApiError } from "../api/client";
import { ArrowRightIcon } from "../components/icons";
import ThemeSwitch from "../components/ThemeSwitch";
import BrandLockup from "../components/BrandLockup";
import LoginFlow from "../components/LoginFlow";
import { routes } from "../routes";

/** The development sign-in's reviewer account (see backend/cases/views/session.py). */
const REVIEWER_USERNAME = "admin";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID = "Enter a valid email address, or Admin for the reviewer portal.";

/** Which portal a sign-in name leads to, once it is a complete one. */
function portalFor(value: string): "reviewer" | "applicant" | null {
  const v = value.trim();
  if (v.toLowerCase() === REVIEWER_USERNAME) return "reviewer";
  return EMAIL_PATTERN.test(v) ? "applicant" : null;
}

/** How it works, on the brand panel. */
const STEPS = [
  { title: "Submit your application", text: "Answer the questions and attach your documents." },
  { title: "AI authenticates the evidence", text: "Every declared answer is checked against its documents." },
  { title: "A reviewer decides", text: "With a risk score and a written assessment." },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const [emailInput, setEmailInput] = useState("");
  const client = useQueryClient();
  const [error, setError] = useState(() =>
    client.getQueryData(keys.sessionEnded) ? "Your session ended. Sign in again to continue." : ""
  );

  // Reaching this page while signed in (pressing Back from the dashboard, say) ends the session, so
  // it is a real sign-in page and Forward cannot return into the app. It is decided once, as soon
  // as who is signed in is known: signing in here afterwards must not sign straight back out.
  const session = useSession();
  const signOut = useSignOut();
  const [signedOut, setSignedOut] = useState(false);
  const arrivalChecked = useRef(false);
  useEffect(() => {
    if (arrivalChecked.current || session.isPending) return;
    arrivalChecked.current = true;
    if (session.data) signOut.mutate(undefined, { onSettled: () => setSignedOut(true) });
  }, [session.isPending, session.data, signOut]);
  // Signing in waits for that check and its sign-out to finish, so a late sign-out cannot end the
  // new session.
  const busy = signIn.isPending || signOut.isPending || session.isPending;

  // Which portal the typed value signs in to (null while it is not a full address or "admin").
  const portal = portalFor(emailInput);
  // The note under the field, if any: an error, the signed-out notice, or the portal it signs in to.
  const hasHint = Boolean(error) || signedOut || portal !== null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!portal) {
      setError(INVALID);
      return;
    }
    setError("");
    signIn.mutate(emailInput.trim(), {
      onSuccess: ({ user }) => navigate(user.role === "reviewer" ? routes.reviewer() : routes.assessments()),
      onError: (err) =>
        setError(
          err instanceof ApiError && err.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : err instanceof ApiError && err.status === 403
              ? err.message
              : (err instanceof ApiError && err.field("email")) || "Sign-in failed. Try again."
        ),
    });
  };

  return (
    <div className="login">
      <section className="login-brand">
        <div className="login-brand-top">
          <BrandLockup className="login-lockup" />
        </div>

        <LoginFlow />

        <div className="login-brand-copy">
          <p className="login-eyebrow">Fit and Proper Assessment</p>
          <p className="login-headline">Fit and proper decisions, backed by the evidence.</p>
          <ol className="login-steps">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="login-step-dot" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="login-step-text">
                  <strong>{step.title}</strong>
                  <span>{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <LoginArtwork />
      </section>

      <div className="login-panel">
        <div className="login-panel-top">
          <ThemeSwitch />
        </div>

        <section className="hero-card login-card">
          <h1 className="hero-title">Sign in</h1>
          <p className="login-sub">Applicant and reviewer portal</p>

          <form className="hero-form" onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label" htmlFor="email-input">
                Email address or username
              </label>
              <input
                id="email-input"
                className="input"
                type="text"
                placeholder="you@example.na"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  // A message about an incomplete address goes as soon as it is complete.
                  if (error === INVALID && portalFor(e.target.value)) setError("");
                }}
                onBlur={() => {
                  if (emailInput.trim() && !portal) setError(INVALID);
                }}
                aria-invalid={error === INVALID || undefined}
                aria-describedby={hasHint ? "email-hint" : undefined}
                autoComplete="username"
                autoFocus
              />
              {error && (
                <p className="field-error" id="email-hint">
                  {error}
                </p>
              )}
              {signedOut && !error && (
                <p className="field-hint" role="status" id="email-hint">
                  You have been signed out. Sign in again to continue.
                </p>
              )}
              {!error && !signedOut && portal && (
                <p className="field-hint login-portal" id="email-hint">
                  {portal === "reviewer"
                    ? "Signing in to the reviewer portal."
                    : "Signing in to the applicant portal."}
                </p>
              )}
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {signIn.isPending ? (
                <>
                  <span className="btn-spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  Continue
                  <ArrowRightIcon size={15} />
                </>
              )}
            </button>
            <p className="hero-hint">
              Assessments appear here once a department initiates one against your application.
              Reviewers sign in as <code>Admin</code>.
            </p>
          </form>
        </section>

        <p className="hero-foot">© {new Date().getFullYear()} iRIS · Fit and Proper Assessment</p>
      </div>
    </div>
  );
}

/** The hexagons of the IRIS slide design, drawn in the theme's own colours. */
function LoginArtwork() {
  // A flat-sided hexagon of the given width, at x, y (its left point).
  const hex = (x: number, y: number, w: number) => {
    const h = (w * Math.sqrt(3)) / 2;
    return [
      [x, y],
      [x + w / 4, y - h / 2],
      [x + (3 * w) / 4, y - h / 2],
      [x + w, y],
      [x + (3 * w) / 4, y + h / 2],
      [x + w / 4, y + h / 2],
    ]
      .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
      .join(" ");
  };
  return (
    // Flat colour only (no gradients or transparency): IRIS Sand, Sage and steps of Seagreen.
    <svg className="login-art" viewBox="0 0 600 520" aria-hidden="true" focusable="false">
      <polygon points={hex(150, 250, 300)} className="login-art-sand" />
      <polygon points={hex(390, 120, 240)} className="login-art-sand" />
      <polygon points={hex(330, 330, 260)} className="login-art-sage" />
      <polygon points={hex(250, 470, 230)} className="login-art-mid" />
      <polygon points={hex(440, 470, 230)} className="login-art-deep" />
    </svg>
  );
}

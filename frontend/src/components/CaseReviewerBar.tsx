import { useState } from "react";
import { ApiError, refusalMessage } from "../api/client";
import { useAssign, useAssignees, useClaim, useRelease, useSession } from "../api/queries";
import type { Assessment, Case } from "../api/types";
import { REVIEWABLE, isSuperUser } from "../state/access";
import { formatDateTime } from "../utils/format";
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, UsersIcon } from "./icons";

/**
 * Who reviews this case. A department can have several admins: the first to take a submitted case
 * reviews it, and only they rule on it, send it on and decide it; the others read it. The reviewer
 * can give it back, and the super user can take it over or give it to another admin. The server
 * checks every step on the locked case, so two admins acting at once never both act.
 */
export default function CaseReviewerBar({ id, assignment, data }: { id: string; assignment: Assessment; data: Case }) {
  const me = useSession().data;
  const superUser = isSuperUser(me);
  const claim = useClaim(id);
  const release = useRelease(id);
  const assign = useAssign(id);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState("");
  const assignees = useAssignees(id, superUser && choosing);

  // Not submitted yet, decided, or the viewer's own application (they never review it).
  if (!REVIEWABLE.includes(data.stage) || assignment.ownApplication || data.reviewer === undefined) return null;
  const reviewer = data.reviewer;
  const mine = reviewer !== null && reviewer.email === me?.email;
  const busy = claim.isPending || release.isPending || assign.isPending;
  const failed = [claim, release, assign].find((m) => m.isError);
  const since = reviewer?.since ? ` since ${formatDateTime(reviewer.since)}` : "";

  return (
    <section className={`card case-reviewer${mine ? " is-mine" : reviewer ? " is-other" : ""}`} aria-label="Reviewer">
      <div className="case-reviewer-row">
        <span className="case-reviewer-icon" aria-hidden="true">
          {mine ? <CheckCircleIcon size={17} /> : reviewer ? <InfoIcon size={17} /> : <UsersIcon size={17} />}
        </span>
        <p className="case-reviewer-text" role="status">
          {reviewer === null ? (
            <>
              <strong>Not taken yet.</strong> Any admin of {assignment.department.name} can review it. Take it to
              rule on it and decide it; the others can then only read it.
            </>
          ) : mine ? (
            <>
              <strong>You are reviewing this case</strong>
              {since}. Only you rule on it and decide it.
            </>
          ) : (
            <>
              <strong>Being reviewed by {reviewer.email}</strong>
              {since}. You can read it; only they rule on it and decide it.
            </>
          )}
        </p>
        <span className="case-reviewer-actions">
          {reviewer === null && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => claim.mutate({})}>
              {claim.isPending ? "Taking…" : "Take this case"}
            </button>
          )}
          {(mine || (reviewer !== null && superUser)) && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => release.mutate(undefined)}>
              Release
            </button>
          )}
          {reviewer !== null && !mine && superUser && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => claim.mutate({ takeOver: true })}
            >
              Take over
            </button>
          )}
          {superUser && !choosing && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setChoosing(true)}>
              Give to…
            </button>
          )}
        </span>
      </div>

      {superUser && choosing && (
        <div className="case-reviewer-assign">
          <label className="field-label" htmlFor={`assign-${id}`}>
            Give it to
          </label>
          <select id={`assign-${id}`} className="input" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="" disabled>
              {assignees.isPending ? "Loading…" : "Choose an admin of this department"}
            </option>
            {(assignees.data ?? [])
              .filter((p) => p.email !== reviewer?.email)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.email}
                  {p.superUser ? " (super user)" : ""}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!chosen || busy}
            onClick={() => {
              const person = assignees.data?.find((p) => String(p.id) === chosen);
              if (!person) return;
              assign.mutate({ userId: person.id, email: person.email }, { onSuccess: () => setChoosing(false) });
            }}
          >
            Give
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </div>
      )}

      {failed && (
        <p className="field-error case-reviewer-error" role="alert">
          <AlertTriangleIcon size={14} />
          {/* The server says why: someone else has it, they no longer work on the department, ... */}
          {failed.error instanceof ApiError && failed.error.status === 409
            ? failed.error.message
            : refusalMessage(failed.error, "detail")}
        </p>
      )}
    </section>
  );
}

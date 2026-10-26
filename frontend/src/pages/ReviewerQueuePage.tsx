import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAssessments, useDepartments, useRemoveAssessment, useSession } from "../api/queries";
import { ApiError } from "../api/client";
import Modal from "../components/Modal";
import { REVIEWABLE, isSuperUser } from "../state/access";
import { daysSince, formatDate } from "../utils/format";
import { STAGE_ORDER, STAGE_LABELS, needsReviewer } from "../state/caseLabels";
import { rememberQueueSearch } from "../state/queueReturn";
import { Loading, LoadError } from "../components/LoadState";
import EmptyState from "../components/EmptyState";
import DepartmentIcon from "../components/DepartmentIcon";
import { routes } from "../routes";
import type { QueueNotice } from "../routes";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BankIcon,
  CheckCircleIcon,
  GridIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersIcon,
  XIcon,
} from "../components/icons";
import type { Assessment, Stage } from "../api/types";

interface QueueRow {
  assignment: Assessment;
  stage: Stage;
}

/**
 * Groups of stages the status filter and the summary tiles offer (the API understands them too).
 * "Needs your action" is the stages needsReviewer() picks, so the tile, the filter and the
 * "need your attention" count always agree.
 */
const GROUPS = {
  NEEDS_ACTION: { label: "Needs your action", stages: STAGE_ORDER.filter(needsReviewer) },
  IN_PROGRESS: { label: "In progress", stages: ["AUTH_RUNNING", "SCORING"] },
  DECIDED: { label: "Decided", stages: ["ACCEPTED", "REJECTED"] },
} satisfies Record<string, { label: string; stages: Stage[] }>;
type Group = keyof typeof GROUPS;
type Status = Stage | Group | "";

/** The status filter in the address, if it is one the queue offers ("" otherwise). */
const toStatus = (value: string | null): Status =>
  value && (value in GROUPS || (STAGE_ORDER as string[]).includes(value)) ? (value as Status) : "";

const statusLabel = (status: Exclude<Status, "">) =>
  status in GROUPS ? GROUPS[status as Group].label : STAGE_LABELS[status as Stage].reviewer;

/** The summary tiles: each a count and a way into that part of the queue. */
const TILES: { status: Group | "AWAITING_APPLICANT"; label: string; tone: string }[] = [
  { status: "NEEDS_ACTION", label: "Needs your action", tone: "critical" },
  { status: "IN_PROGRESS", label: "In progress", tone: "info" },
  { status: "AWAITING_APPLICANT", label: "Waiting on applicants", tone: "warning" },
  { status: "DECIDED", label: "Decided", tone: "good" },
];

export default function ReviewerQueuePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as QueueNotice | null)?.notice;
  // The filters and search live in the address (?status=&department=&q=), so Back from a case,
  // a reload or a shared link shows the same list.
  const [params, setParams] = useSearchParams();
  // "" lists every department.
  const department = params.get("department") ?? "";
  // "" is every submitted case (the queue); a stage narrows it to that stage. NOT_SUBMITTED lists
  // the ones not submitted yet, to find or remove one opened for an applicant.
  const status = toStatus(params.get("status"));
  const showDrafts = status === "NOT_SUBMITTED";
  const search = (params.get("q") ?? "").trim();
  // Whose cases: "" every one, "mine" the viewer's, "none" those no admin has taken yet.
  const holderParam = params.get("holder");
  const holder = holderParam === "mine" || holderParam === "none" ? holderParam : "";
  // A filter change replaces the address rather than adding to the history (Back leaves the
  // queue), and keeps any notice on screen.
  const setFilter = useCallback(
    (name: "department" | "status" | "q" | "holder", value: string) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value) next.set(name, value);
          else next.delete(name);
          return next;
        },
        { replace: true, state: location.state }
      ),
    [setParams, location.state]
  );
  // What is typed, searched for once typing pauses.
  const [searchText, setSearchText] = useState(search);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchText.trim() !== search) setFilter("q", searchText.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText, search, setFilter]);
  // The address changed some other way (Back, Forward): the box shows what is searched for.
  const [searchShown, setSearchShown] = useState(search);
  if (searchShown !== search) {
    setSearchShown(search);
    if (searchText.trim() !== search) setSearchText(search);
  }
  // Where "Back to the queue" returns to.
  useEffect(() => rememberQueueSearch(location.search), [location.search]);
  const departments = useDepartments();
  // The application the reviewer asked to remove, while they confirm it.
  const [toRemove, setToRemove] = useState<Assessment | null>(null);
  // The admin panel is the super user's; an admin sees their own departments only.
  const me = useSession().data;
  const superUser = isSuperUser(me);
  // Refreshes itself while any listed case is still with the engine, and every so often.
  const list = useAssessments(department, status, search, { live: true, holder });

  if (list.isPending) return <Loading />;
  if (list.isError && !list.data) return <LoadError error={list.error} onRetry={() => list.refetch()} />;

  // In the server's order: the case acted on most recently first, whatever its stage. "Show more"
  // therefore adds rows at the end, never among the ones already on screen.
  // A case that moved up while the pages were read can be in two of them: it shows once, where it
  // is now (the earlier page).
  const seen = new Set<string>();
  const rows: QueueRow[] = list.data.pages
    .flatMap((p) => p.results)
    .filter((a) => !seen.has(a.id) && Boolean(seen.add(a.id)))
    .map((assignment) => ({ assignment, stage: assignment.stage }));

  // The whole queue's counts, not just the pages loaded so far (they come with the first page).
  const first = list.data.pages[0];
  const total = first?.total ?? rows.length;
  // Waiting on this reviewer: needing a reviewer, and not taken by another admin (as the server
  // counts `actionable`).
  const onMe = (r: QueueRow) =>
    needsReviewer(r.stage) && (!r.assignment.reviewer || r.assignment.reviewer.email === me?.email);
  const actionable = first?.actionable ?? rows.filter(onMe).length;
  // The queue lists the latest activity first, so a case needing the reviewer that has not moved in
  // a while can be further down than the rows loaded: say so, with a way to list just those.
  const actionableBelow = actionable - rows.filter(onMe).length;
  const departmentName = departments.data?.find((d) => d.key === department)?.name;
  const stageCounts = first?.stageCounts ?? {};
  const tileCount = (tile: (typeof TILES)[number]) =>
    tile.status in GROUPS
      ? GROUPS[tile.status as Group].stages.reduce((n, s) => n + (stageCounts[s] ?? 0), 0)
      : (stageCounts[tile.status as Stage] ?? 0);

  // A filter or search just changed and its list is on the way: what is on screen still belongs to
  // the one before, so the page says it is updating and the old list can't be opened meanwhile.
  const stale = list.isPlaceholderData;

  const openCase = (row: QueueRow) => {
    const target = row.stage === "DECISION_PENDING" ? "result" : "authentication";
    navigate(
      target === "result"
        ? routes.reviewerResult(row.assignment.id)
        : routes.reviewerAuthentication(row.assignment.id)
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Assessment queue</h1>
          <p className="page-sub">
            {stale ? (
              "Updating the list…"
            ) : (
              <>
                {total} {showDrafts ? "not yet submitted" : "submitted"} fit and proper assessment
                {total === 1 ? "" : "s"}
                {status && !showDrafts ? ` with status ${statusLabel(status)}` : ""}
                {search ? ` matching “${search}”` : ""}{" "}
                {departmentName
                  ? `for ${departmentName}`
                  : superUser
                    ? "across all departments"
                    : "across your departments"}
                .{" "}
                {actionable > 0
                  ? `${actionable} need${actionable === 1 ? "s" : ""} your attention.`
                  : "Nothing is waiting on you."}
              </>
            )}
          </p>
        </div>
        <div className="page-head-aside">
          {superUser && (
            <button className="btn btn-ghost" onClick={() => navigate(routes.reviewerAdmin())}>
              <GridIcon size={15} />
              Admin panel
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => navigate(routes.reviewerQuestions())}>
            <SlidersIcon size={15} />
            Configure questions
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice notice-good" role="status">
          <CheckCircleIcon size={17} />
          <div>{notice}</div>
        </div>
      )}

      <div className={`queue-kpis${stale ? " is-stale" : ""}`} role="group" aria-label="Queue summary">
        {TILES.map((tile) => {
          const on = status === tile.status;
          return (
            <button
              key={tile.status}
              type="button"
              className={`queue-kpi is-${tile.tone}${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => setFilter("status", on ? "" : tile.status)}
            >
              <span className="queue-kpi-count">{tileCount(tile)}</span>
              <span className="queue-kpi-label">{tile.label}</span>
            </button>
          );
        })}
      </div>

      <div className="queue-filter">
        <label className="queue-search">
          <SearchIcon size={15} />
          <input
            type="search"
            className="input"
            placeholder="Search name, reference or case ID"
            aria-label="Search the queue"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </label>
        <label className="field-label" htmlFor="queue-status">
          Status
        </label>
        <select
          id="queue-status"
          className="input"
          value={status}
          onChange={(e) => setFilter("status", e.target.value)}
        >
          <option value="">All submitted</option>
          <optgroup label="Groups">
            {(Object.keys(GROUPS) as Group[]).map((g) => (
              <option key={g} value={g}>
                {GROUPS[g].label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Stage">
            {STAGE_ORDER.filter((s) => s !== "NOT_SUBMITTED").map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s].reviewer}
              </option>
            ))}
          </optgroup>
          <option value="NOT_SUBMITTED">Not submitted yet</option>
        </select>
        <label className="field-label" htmlFor="queue-department">
          Department
        </label>
        <select
          id="queue-department"
          className="input"
          value={department}
          onChange={(e) => setFilter("department", e.target.value)}
        >
          <option value="">{superUser ? "All departments" : "All your departments"}</option>
          {departments.data?.map((d) => (
            <option key={d.key} value={d.key}>
              {d.name}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="queue-holder">
          Reviewer
        </label>
        <select id="queue-holder" className="input" value={holder} onChange={(e) => setFilter("holder", e.target.value)}>
          <option value="">Anyone</option>
          <option value="mine">Mine</option>
          <option value="none">Not taken yet</option>
        </select>
      </div>

      {!stale && !status && actionableBelow > 0 && (
        <div className="notice notice-warning" role="status">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>
              {actionableBelow} more need{actionableBelow === 1 ? "s" : ""} your action
            </strong>{" "}
            further down the queue.{" "}
            <button type="button" className="link-button" onClick={() => setFilter("status", "NEEDS_ACTION")}>
              Show only those needing your action
            </button>
          </div>
        </div>
      )}

      <div className={`queue-results${stale ? " is-stale" : ""}`} aria-busy={stale || undefined}>
        {rows.length === 0 ? (
          <EmptyState
            icon={<BankIcon size={22} />}
            title={
              search
                ? `No assessments match “${search}”`
                : showDrafts
                  ? departmentName
                    ? `Nothing waiting to be submitted for ${departmentName}`
                    : "Nothing waiting to be submitted"
                  : status
                    ? `No assessments with status ${statusLabel(status)}${departmentName ? ` for ${departmentName}` : ""}`
                    : departmentName
                      ? `No submitted assessments for ${departmentName}`
                      : "No submitted assessments yet"
            }
          >
            {search
              ? "Check the spelling, or search by another part of the name, the application reference or the case ID."
              : showDrafts
                ? "Applications opened or started but not submitted yet appear here. Open one to see it or remove it."
                : status
                  ? "Choose another status, or All submitted, to see the rest of the queue."
                  : "Assessments appear here once the applicant submits them."}
          </EmptyState>
        ) : (
          <div className="case-grid">
            {rows.map((row) => {
              const { assignment, stage } = row;
              const label = STAGE_LABELS[stage];
              const waited = daysSince(assignment.stageSince ?? assignment.updatedAt);
              return (
                <div className="case-card-wrap" key={assignment.id}>
                  <button className="case-card" onClick={() => openCase(row)}>
                    <div className="case-card-head">
                      <span className="case-avatar">
                        <DepartmentIcon departmentKey={assignment.department.key} size={16} />
                      </span>
                      <span className={`chip chip-${label.tone}`}>
                        {needsReviewer(stage) && stage !== "DECISION_PENDING" && <AlertTriangleIcon size={12} />}
                        {stage === "DECISION_PENDING" && <ShieldCheckIcon size={12} />}
                        {stage === "ACCEPTED" && <CheckCircleIcon size={12} />}
                        {label.reviewer}
                      </span>
                    </div>
  
                    <h2 className="case-name">{assignment.applicantName}</h2>
                    <p className="case-role">
                      {assignment.position} · {assignment.entity}
                    </p>
  
                    {needsReviewer(stage) && waited >= 1 && (
                      <p className={`case-age${waited >= 3 ? " is-late" : ""}`}>
                        Waiting {waited} day{waited === 1 ? "" : "s"}
                      </p>
                    )}
  
                    <dl className="case-meta">
                      <div>
                        <dt>Reference</dt>
                        <dd>{assignment.reference}</dd>
                      </div>
                      <div>
                        <dt>Initiated</dt>
                        <dd>{formatDate(assignment.initiatedOn)}</dd>
                      </div>
                      <div>
                        <dt>Department</dt>
                        <dd>{assignment.department.name}</dd>
                      </div>
                      {/* Who reviews it: one of the department's admins takes each submitted case. */}
                      {assignment.reviewer !== undefined && (REVIEWABLE.includes(stage) || assignment.reviewer) && (
                        <div>
                          <dt>Reviewer</dt>
                          <dd>
                            {assignment.reviewer === null ? (
                              <span className="case-card-reviewer">Not taken yet</span>
                            ) : assignment.reviewer.email === me?.email ? (
                              <span className="case-card-reviewer is-mine">You</span>
                            ) : (
                              <span className="case-card-reviewer">{assignment.reviewer.email}</span>
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>
  
                    <footer className="case-foot">
                      <CaseFootNote row={row} />
                      <span className="case-open">
                        {stage === "DECISION_PENDING" ? "Decide" : "Open"}
                        <ArrowRightIcon size={14} />
                      </span>
                    </footer>
                  </button>
                  {/* Beside the card rather than in it: a button cannot hold another button. */}
                  <button
                    type="button"
                    className="case-remove"
                    aria-label={`Remove ${assignment.applicantName}'s application ${assignment.id}`}
                    aria-disabled={!assignment.removable || undefined}
                    title={
                      assignment.removable
                        ? "Remove this application"
                        : assignment.reviewer && assignment.reviewer.email !== me?.email && !superUser
                          ? "Another admin is reviewing it: only they, or the super user, can remove it"
                          : "With the AI engine right now: it can be removed once the run has finished"
                    }
                    onClick={() => {
                      if (assignment.removable) setToRemove(assignment);
                    }}
                  >
                    <XIcon size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {list.hasNextPage && (
          <div className="queue-more">
            <button
              className="btn btn-ghost"
              disabled={list.isFetching}
              onClick={async () => {
                // The list is in order of the latest action: a case acted on since these pages were
                // read has moved up, past where the next page starts. Reading them again first
                // brings it to the top rather than leaving it out.
                await list.refetch();
                await list.fetchNextPage();
              }}
            >
              {list.isFetching ? "Loading…" : "Show more"}
            </button>
          </div>
        )}
      </div>

      {toRemove && <RemoveDialog assignment={toRemove} onClose={() => setToRemove(null)} />}
    </div>
  );
}

/** Asks before an application is removed for good, and says what goes with it. */
function RemoveDialog({ assignment, onClose }: { assignment: Assessment; onClose: () => void }) {
  const removal = useRemoveAssessment(assignment.id);
  const submitted = assignment.stage !== "NOT_SUBMITTED";
  return (
    <Modal labelledBy="remove-case-title" dismissible={!removal.isPending} onClose={onClose}>
      <span className="modal-icon">
        <AlertTriangleIcon size={20} />
      </span>
      <h2 id="remove-case-title">Remove {assignment.applicantName}'s application?</h2>
      <p className="modal-sub">
        {assignment.id} · {assignment.reference} · {STAGE_LABELS[assignment.stage].reviewer}. It is deleted for good with
        its answers and documents
        {submitted ? ", the AI engine's results, the rulings, the score and any decision" : ""}. The applicant no longer
        sees it. This cannot be undone.
      </p>
      {removal.isError && (
        <p className="field-error" role="alert">
          {removal.error instanceof ApiError && removal.error.status === 409
            ? removal.error.message
            : "It was not removed. Check your connection and try again."}
        </p>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" disabled={removal.isPending} onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-critical"
          disabled={removal.isPending}
          onClick={() => removal.mutate(undefined, { onSuccess: onClose })}
        >
          {removal.isPending ? "Removing…" : "Remove application"}
        </button>
      </div>
    </Modal>
  );
}

function CaseFootNote({ row }: { row: QueueRow }) {
  const { flagged, openFlags, rejected, decisionRemarks } = row.assignment.queue;

  if (row.stage === "REVIEW_PENDING" && openFlags === 0 && flagged.length > 0) {
    return <span className="case-note is-critical">All answers ruled on — send it on</span>;
  }
  if (row.stage === "REVIEW_PENDING") {
    return (
      <span className="case-note is-critical">
        {openFlags} question{openFlags === 1 ? "" : "s"} to rule on
        {flagged.length > 0 && ` (${flagged.join(", ")})`}
      </span>
    );
  }
  if (row.stage === "AWAITING_APPLICANT") {
    return <span className="case-note">Rejected {rejected.join(", ")} — waiting on new evidence</span>;
  }
  if (row.stage === "DECISION_PENDING") {
    return <span className="case-note">Ready for your decision — accept or reject</span>;
  }
  if (row.stage === "AUTH_FAILED") {
    return <span className="case-note is-critical">Authentication failed — open to send it again</span>;
  }
  if (decisionRemarks) {
    return <span className="case-note">{decisionRemarks.slice(0, 90)}</span>;
  }
  if (row.stage === "NOT_SUBMITTED") {
    return <span className="case-note">Waiting on the applicant</span>;
  }
  return <span className="case-note">No action needed</span>;
}

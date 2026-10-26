import { useNavigate } from "react-router-dom";
import { useAdminOverview } from "../api/queries";
import AdminHeader from "../components/AdminHeader";
import { Loading, LoadError } from "../components/LoadState";
import { AlertTriangleIcon, ArrowLeftIcon, ArrowRightIcon } from "../components/icons";
import { STAGE_LABELS, stageRank } from "../state/caseLabels";
import { formatBytes, formatDateTime } from "../utils/format";
import { routes } from "../routes";
import { queueUrl } from "../state/queueReturn";
import type { Stage } from "../api/types";

/** One headline number with what it counts. */
function Stat({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="admin-stat">
      <dt>{label}</dt>
      <dd>
        <span className="admin-stat-value">{value}</span>
        <span className="admin-stat-note">{note}</span>
      </dd>
    </div>
  );
}

/**
 * Counts as horizontal bars in one colour, longest bar the largest count, the count written
 * beside each so nothing is read from the bar length alone.
 */
function Bars({ rows, unit }: { rows: { key: string; label: string; count: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="sectionbars admin-bars">
      {rows.map((r) => (
        <div className="sbar-row" key={r.key} title={`${r.label}: ${r.count} ${unit}${r.count === 1 ? "" : "s"}`}>
          <span className="sbar-label">{r.label}</span>
          <span className="sbar-track" aria-hidden="true">
            <span className="sbar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="sbar-value">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminOverviewPage() {
  const navigate = useNavigate();
  const overview = useAdminOverview();

  if (overview.isPending) return <Loading />;
  if (overview.isError && !overview.data) return <LoadError error={overview.error} onRetry={() => overview.refetch()} />;
  const { users, assessments, runs, documents, recentDays, generatedAt } = overview.data;
  const recent = `last ${recentDays} days`;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const stages = (Object.keys(assessments.byStage) as Stage[])
    .sort((a, b) => stageRank(a) - stageRank(b))
    .map((stage) => ({ key: stage, label: STAGE_LABELS[stage].reviewer, count: assessments.byStage[stage] }));
  const departments = assessments.byDepartment.map((d) => ({ key: d.key, label: d.name, count: d.count }));

  return (
    <div className="page">
      <AdminHeader active="overview" sub="Who uses the system, and the assessments in it." />

      {assessments.awaitingReviewer > 0 && (
        <div className="notice notice-warning">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>{plural(assessments.awaitingReviewer, "assessment")} waiting on the reviewer</strong> (a
            review, a decision or a failed run).{" "}
            <button type="button" className="link-button" onClick={() => navigate(queueUrl())}>
              Open the queue
            </button>
          </div>
        </div>
      )}

      <section aria-labelledby="admin-users-heading">
        <h2 className="admin-group-title" id="admin-users-heading">
          Users
        </h2>
        <dl className="admin-stats">
          <Stat label="All users" value={users.total} note={`${plural(users.applicants, "user")} · ${plural(users.admins ?? users.reviewers, "admin")}${users.superUsers ? ` · ${plural(users.superUsers, "super user")}` : ""}`} />
          <Stat label="Active" value={users.active} note={`${users.inactive} deactivated`} />
          <Stat label="New" value={users.newRecently} note={`joined in the ${recent}`} />
          <Stat label="Signed in" value={users.signedInRecently} note={`in the ${recent}`} />
        </dl>
      </section>

      <section aria-labelledby="admin-assessments-heading">
        <h2 className="admin-group-title" id="admin-assessments-heading">
          Assessments
        </h2>
        <dl className="admin-stats">
          <Stat label="All assessments" value={assessments.total} note={`${assessments.submittedRecently} submitted in the ${recent}`} />
          <Stat label="Waiting on the reviewer" value={assessments.awaitingReviewer} note="review, decision or failed run" />
          <Stat
            label="Decided"
            value={assessments.accepted + assessments.rejected}
            note={`${assessments.accepted} accepted · ${assessments.rejected} rejected`}
          />
          <Stat label="Engine runs failed" value={runs.failed} note={`${runs.inProgress} in progress`} />
          <Stat label="Documents stored" value={documents.count} note={formatBytes(documents.bytes)} />
        </dl>
      </section>

      <div className="admin-panels">
        <section className="card">
          <header className="card-head">
            <h2>Assessments by stage</h2>
            <p className="card-sub">Most urgent first, as the queue orders them.</p>
          </header>
          <Bars rows={stages} unit="assessment" />
        </section>
        <section className="card">
          <header className="card-head">
            <h2>Assessments by department</h2>
            <p className="card-sub">Every department, including those with none yet.</p>
          </header>
          <Bars rows={departments} unit="assessment" />
        </section>
      </div>

      <p className="admin-asof">As of {formatDateTime(generatedAt)}</p>

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate(queueUrl())}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
        <button className="btn btn-primary" onClick={() => navigate(routes.reviewerAdminUsers())}>
          View users
          <ArrowRightIcon size={15} />
        </button>
      </footer>
    </div>
  );
}

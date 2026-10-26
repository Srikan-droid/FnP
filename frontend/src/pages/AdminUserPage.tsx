import { Link, useNavigate, useParams } from "react-router-dom";
import { useAdminUser } from "../api/queries";
import { ApiError } from "../api/client";
import AdminHeader from "../components/AdminHeader";
import EmptyState from "../components/EmptyState";
import { Loading, LoadError } from "../components/LoadState";
import { ArrowLeftIcon, FileTextIcon, UsersIcon } from "../components/icons";
import { STAGE_LABELS } from "../state/caseLabels";
import { formatDateTime } from "../utils/format";
import { routes } from "../routes";
import { RoleChip, StatusChip } from "./AdminUsersPage";
import { departmentList } from "../state/access";
import AccessCard from "../components/admin/AccessCard";
import type { AdminUserDetail, Stage } from "../api/types";

/** The audit trail's actions in words. An action not listed here is shown as recorded. */
const ACTIONS: Record<string, string> = {
  "session.sign_in": "Signed in",
  "session.sign_out": "Signed out",
  "assessment.create": "Opened an assessment",
  "assessment.remove": "Removed an assessment",
  "form.reset": "Started the form over",
  "evidence.upload": "Uploaded a document",
  "evidence.remove": "Removed a document",
  "case.submit": "Submitted for authentication",
  "case.resubmit": "Resubmitted for authentication",
  "case.retry": "Sent a failed run again",
  "case.rule": "Ruled on a flagged answer",
  "case.undo_ruling": "Undid a ruling",
  "case.decide": "Decided the assessment",
  "case.auth_failed": "Authentication failed",
  "case.review_pending": "Sent to the reviewer",
  "case.returned_to_applicant": "Returned to the applicant",
  "case.scoring": "Moved to scoring",
  "case.scored": "Scored",
  "case.ready_for_decision": "Sent for the reviewer's decision",
  "case.force_score": "Asked the AI engine to score after accepting flagged answers",
  "case.force_score_failed": "The AI engine did not score it after the reviewer's request",
  "questionnaire.publish": "Published question settings",
  "user.activate": "Reactivated an account",
  "user.deactivate": "Deactivated an account",
  "user.role_change": "Changed an account's role",
  "user.departments_change": "Changed an admin's departments",
  "department.create": "Added a department",
  "department.update": "Changed a department",
};

/** Where the reviewer works on a case: the decision page once it is waiting for one. */
const caseRoute = (id: string, stage: Stage) =>
  stage === "DECISION_PENDING" ? routes.reviewerResult(id) : routes.reviewerAuthentication(id);

/** The AI engine's ID for the latest run, or why there is none yet. */
function RequestId({ assessment: a }: { assessment: AdminUserDetail["assessments"][number] }) {
  if (!a.requestId) {
    return (
      <>
        <span className="admin-muted">—</span>
        <span className="admin-muted admin-sub">
          {a.runCount === 0
            ? "Not submitted"
            : a.runStatus === "failed"
              ? "Not sent: the run failed"
              : "Waiting for the engine"}
        </span>
      </>
    );
  }
  return (
    <>
      <code className="admin-request-id">{a.requestId}</code>
      {a.runCount > 1 && <span className="admin-muted admin-sub">Latest of {a.runCount} runs</span>}
    </>
  );
}

export default function AdminUserPage() {
  const navigate = useNavigate();
  const userId = Number(useParams().userId);
  const user = useAdminUser(userId);
  const back = (
    <footer className="actionbar">
      <button className="btn btn-ghost" onClick={() => navigate(routes.reviewerAdminUsers())}>
        <ArrowLeftIcon size={15} />
        Back to users
      </button>
    </footer>
  );

  const notFound =
    !Number.isInteger(userId) || userId < 1 || (user.isError && user.error instanceof ApiError && user.error.status === 404);
  if (notFound) {
    return (
      <div className="page">
        <AdminHeader active="users" sub="One account's access, assessments and recent activity." />
        <EmptyState icon={<UsersIcon size={22} />} title="User not found">
          There is no account with this number. It may have been mistyped.
        </EmptyState>
        {back}
      </div>
    );
  }
  if (user.isPending) return <Loading />;
  if (user.isError && !user.data) return <LoadError error={user.error} onRetry={() => user.refetch()} />;
  const u = user.data;

  return (
    <div className="page">
      <AdminHeader active="users" sub="One account's access, assessments and recent activity." />

      <section className="card admin-person">
        <div className="admin-person-head">
          <span className="admin-person-avatar" aria-hidden="true">
            {(u.email.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "?").toUpperCase()}
          </span>
          <div className="admin-person-text">
            <h2>{u.email}</h2>
            <div className="admin-person-chips">
              <RoleChip user={u} />
              <StatusChip active={u.isActive} />
            </div>
          </div>
        </div>
        <dl className="applicant-summary-grid">
          <div>
            <dt>Joined</dt>
            <dd>{formatDateTime(u.joinedAt)}</dd>
          </div>
          <div>
            <dt>Last sign-in</dt>
            <dd>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</dd>
          </div>
          <div>
            <dt>Assessments</dt>
            <dd>{u.assessments.length}</dd>
          </div>
          {departmentList(u) && (
            <div>
              <dt>Departments</dt>
              <dd>{departmentList(u)}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Keyed on the access saved, so a save starts the card again from what the server holds. */}
      <AccessCard key={`${u.role}:${u.isActive}:${u.departments.map((d) => d.key).join()}`} user={u} />

      <section className="card">
        <header className="card-head">
          <h2>Assessments</h2>
          <p className="card-sub">
            {u.role === "applicant" ? "Applications this person fills in." : "Admins and super users do not apply for assessments."}
          </p>
        </header>
        {u.assessments.length === 0 ? (
          <p className="admin-none">None.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Assessment</th>
                  <th scope="col">Request ID</th>
                  <th scope="col">Applicant</th>
                  <th scope="col">Department</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Last change</th>
                </tr>
              </thead>
              <tbody>
                {u.assessments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={caseRoute(a.id, a.stage)}>{a.id}</Link>
                    </td>
                    <td>
                      <RequestId assessment={a} />
                    </td>
                    <td>
                      {a.applicantName}
                      <span className="admin-muted admin-sub">{a.position}</span>
                    </td>
                    <td>{a.department.name}</td>
                    <td>
                      <span className={`chip chip-${STAGE_LABELS[a.stage].tone}`}>{STAGE_LABELS[a.stage].reviewer}</span>
                    </td>
                    <td>{formatDateTime(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Recent activity</h2>
          <p className="card-sub">The latest {u.activity.length || ""} things this account did, newest first.</p>
        </header>
        {u.activity.length === 0 ? (
          <p className="admin-none">Nothing recorded yet.</p>
        ) : (
          <ol className="admin-activity">
            {u.activity.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                <span className="admin-activity-action">{ACTIONS[e.action] ?? e.action}</span>
                {e.assessmentRef && (
                  <span className="admin-activity-ref">
                    <FileTextIcon size={13} />
                    {e.assessmentRef}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {back}
    </div>
  );
}

import { useState } from "react";
import { useDepartments, useSession, useUpdateAccess } from "../../api/queries";
import { ApiError } from "../../api/client";
import type { AccountRole, AdminUserDetail } from "../../api/types";
import { AlertTriangleIcon } from "../icons";

const ROLES: { role: AccountRole; label: string; hint: string }[] = [
  { role: "applicant", label: "User", hint: "Applies for fit and proper assessments." },
  { role: "reviewer", label: "Admin", hint: "Reviews and decides the cases of the departments chosen below, and configures their questions." },
  { role: "superuser", label: "Super user", hint: "Every department, and manages accounts and departments in the admin panel." },
];

/** The refusal in words: the server says why a change cannot be made. */
function refusal(error: unknown): string {
  if (error instanceof ApiError) {
    const messages = Object.values(error.body).flat().map(String);
    if (messages.length > 0) return messages.join(" ");
  }
  return "The change was not saved. Check your connection and try again.";
}

/**
 * The super user changes what an account is: a user, an admin of some departments, or a super
 * user, and whether it may sign in. Nothing changes until Save; a changed role signs the person
 * out, so they come back to the app as they now are.
 */
export default function AccessCard({ user }: { user: AdminUserDetail }) {
  const me = useSession().data;
  const departments = useDepartments();
  const update = useUpdateAccess(user.id);
  const [role, setRole] = useState<AccountRole>(user.role);
  const [chosen, setChosen] = useState<string[]>(user.departments.map((d) => d.key));
  const [active, setActive] = useState(user.isActive);

  const own = me?.email === user.email;
  const fixed = user.accessFixed || own;
  const initialKeys = user.departments.map((d) => d.key).sort().join();
  const changed =
    role !== user.role || active !== user.isActive || (role === "reviewer" && [...chosen].sort().join() !== initialKeys);
  const needsDepartment = role === "reviewer" && chosen.length === 0;
  const toggle = (key: string) => {
    setChosen((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
    update.reset();
  };
  const save = () =>
    update.mutate({
      ...(role !== user.role ? { role } : {}),
      ...(role === "reviewer" ? { departments: chosen } : {}),
      ...(active !== user.isActive ? { isActive: active } : {}),
    });

  return (
    <section className="card admin-access" aria-labelledby="access-title">
      <header className="card-head">
        <h2 id="access-title">Access</h2>
        <p className="card-sub">
          {fixed
            ? own
              ? "Your own account: another super user can change its access."
              : "The built-in admin sign-in and staff accounts keep their access."
            : "What this account can do. A changed role, or switching the account off, signs the person out."}
        </p>
      </header>
      <fieldset className="admin-access-body" disabled={fixed || update.isPending}>
        <legend className="sr-only">Role</legend>
        <div className="admin-roles" role="radiogroup" aria-label="Role">
          {ROLES.map((r) => (
            <label key={r.role} className={`admin-role${role === r.role ? " is-on" : ""}`}>
              <input
                type="radio"
                name="role"
                value={r.role}
                checked={role === r.role}
                onChange={() => {
                  setRole(r.role);
                  update.reset();
                }}
              />
              <span className="admin-role-name">{r.label}</span>
              <span className="admin-role-hint">{r.hint}</span>
            </label>
          ))}
        </div>

        {role === "reviewer" && (
          <div className="admin-access-row">
            <span className="field-label" id="access-departments">
              Departments this admin works on
            </span>
            <div className="chipset" role="group" aria-labelledby="access-departments">
              {(departments.data ?? []).map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`toggle-chip${chosen.includes(d.key) ? " is-on" : ""}`}
                  aria-pressed={chosen.includes(d.key)}
                  onClick={() => toggle(d.key)}
                >
                  {d.name}
                  {d.isActive === false ? " (switched off)" : ""}
                </button>
              ))}
            </div>
            {needsDepartment && <span className="field-error">Choose at least one department.</span>}
          </div>
        )}

        <label className="admin-access-switch">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              setActive(e.target.checked);
              update.reset();
            }}
          />
          <span>
            <strong>Can sign in</strong>
            <span className="admin-role-hint">Switched off, the account cannot sign in; what it holds stays.</span>
          </span>
        </label>
      </fieldset>

      {!fixed && (user.reviewing ?? 0) > 0 && (
        <p className="admin-access-note" role="note">
          They are reviewing {user.reviewing} case{user.reviewing === 1 ? "" : "s"}. Any they can no longer act on
          (outside their departments, or if they become a user or are switched off) go back to the
          queue, for another admin to take.
        </p>
      )}

      {update.isError && (
        <p className="field-error admin-access-error" role="alert">
          <AlertTriangleIcon size={14} />
          {refusal(update.error)}
        </p>
      )}

      {!fixed && (
        <div className="admin-access-foot">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!changed || update.isPending}
            onClick={() => {
              setRole(user.role);
              setChosen(user.departments.map((d) => d.key));
              setActive(user.isActive);
              update.reset();
            }}
          >
            Undo changes
          </button>
          <button type="button" className="btn btn-primary" disabled={!changed || needsDepartment || update.isPending} onClick={save}>
            {update.isPending ? "Saving…" : "Save access"}
          </button>
        </div>
      )}
    </section>
  );
}

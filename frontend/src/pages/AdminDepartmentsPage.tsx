import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAdminDepartments, useDepartmentChanges } from "../api/queries";
import { ApiError } from "../api/client";
import type { AdminDepartment } from "../api/types";
import AdminHeader from "../components/AdminHeader";
import DepartmentIcon from "../components/DepartmentIcon";
import { Loading, LoadError } from "../components/LoadState";
import Modal from "../components/Modal";
import { ArrowLeftIcon, PencilIcon, PlusIcon, SlidersIcon } from "../components/icons";
import { queueUrl } from "../state/queueReturn";
import { routes } from "../routes";

/**
 * A key as it is typed: lower case, anything but letters and numbers turned into one hyphen. A
 * hyphen at the end stays while typing (the next word follows it); it is dropped on saving.
 */
const keyTyping = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 32);

/** A key from a name, or a typed key as saved: no hyphen at either end ("Pension Funds" gives "pension-funds"). */
const keyFrom = (text: string) => keyTyping(text).replace(/-+$/, "");

/** The server's objections, by field (and any general one under "detail"). */
function problems(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return { detail: "Not saved. Check your connection and try again." };
  return Object.fromEntries(Object.entries(error.body).map(([k, v]) => [k, [v].flat().map(String).join(" ")]));
}

type Editing = { kind: "new" } | { kind: "edit"; department: AdminDepartment };

/**
 * The super user's departments: each has its own questionnaire, admins and cases. A department is
 * added with a copy of another's questions (or the published model), renamed, or switched off — it
 * then takes no new applications, while its cases carry on. Departments are never deleted.
 */
export default function AdminDepartmentsPage() {
  const navigate = useNavigate();
  const list = useAdminDepartments();
  const { update } = useDepartmentChanges();
  const [editing, setEditing] = useState<Editing | null>(null);

  if (list.isPending) return <Loading />;
  if (list.isError && !list.data) return <LoadError error={list.error} onRetry={() => list.refetch()} />;

  return (
    <div className="page">
      <AdminHeader
        active="departments"
        sub="Each department has its own questions, admins and cases. Add one, rename it, or switch it off."
      />

      <div className="admin-dept-actions">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ kind: "new" })}>
          <PlusIcon size={15} />
          Add department
        </button>
      </div>

      <div className="card admin-table-card">
        <div className="table-wrap">
          <table className="data-table admin-table admin-dept-table">
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Questions
                </th>
                <th scope="col" className="num">
                  Admins
                </th>
                <th scope="col" className="num">
                  Assessments
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.key} className={d.isActive ? undefined : "is-off"}>
                  <td>
                    <span className="admin-dept-name">
                      <DepartmentIcon departmentKey={d.key} size={15} />
                      {d.name}
                    </span>
                    <span className="admin-muted admin-sub">
                      {d.key}
                      {d.blurb ? ` · ${d.blurb}` : ""}
                    </span>
                  </td>
                  <td>
                    {!d.isActive ? (
                      <span className="chip chip-neutral">Switched off</span>
                    ) : d.questionCount === 0 ? (
                      <span className="chip chip-serious">No questions yet</span>
                    ) : (
                      <span className="chip chip-low">Taking applications</span>
                    )}
                  </td>
                  <td className="num">
                    {d.questionCount}
                    {d.version && <span className="admin-muted admin-sub">{d.version}</span>}
                  </td>
                  <td className="num">
                    {d.adminCount}
                    {d.adminCount === 0 && (d.waitingCount ?? 0) > 0 && (
                      <span className="admin-sub admin-warn">No admin — {d.waitingCount} waiting</span>
                    )}
                  </td>
                  <td className="num">{d.assessmentCount}</td>
                  <td>
                    <span className="admin-dept-row-actions">
                      <Link className="btn btn-ghost btn-sm" to={`${routes.reviewerQuestions()}?department=${encodeURIComponent(d.key)}`}>
                        <SlidersIcon size={13} />
                        Questions
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Edit ${d.name}`}
                        onClick={() => setEditing({ kind: "edit", department: d })}
                      >
                        <PencilIcon size={13} />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ key: d.key, isActive: !d.isActive })}
                      >
                        {d.isActive ? "Switch off" : "Switch on"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {update.isError && !editing && (
        <p className="field-error" role="alert">
          {Object.values(problems(update.error)).join(" ")}
        </p>
      )}

      {editing && (
        <DepartmentDialog
          editing={editing}
          departments={list.data}
          onClose={() => setEditing(null)}
        />
      )}

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate(queueUrl())}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
      </footer>
    </div>
  );
}

/** Adding a department, or changing one's name and description. */
function DepartmentDialog({
  editing,
  departments,
  onClose,
}: {
  editing: Editing;
  departments: AdminDepartment[];
  onClose: () => void;
}) {
  const { create, update } = useDepartmentChanges();
  const existing = editing.kind === "edit" ? editing.department : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [blurb, setBlurb] = useState(existing?.blurb ?? "");
  const [key, setKey] = useState("");
  const [keyTyped, setKeyTyped] = useState(false);
  // A new department starts with no questions unless another's are copied.
  const [startFrom, setStartFrom] = useState<string>("");
  const mutation = existing ? update : create;
  const errors = mutation.isError ? problems(mutation.error) : {};
  const shownKey = keyTyped ? key : keyFrom(name);
  const savedKey = keyFrom(shownKey);
  const ready = name.trim() !== "" && (existing !== null || savedKey !== "");

  const submit = () => {
    if (!ready) return;
    if (existing) {
      update.mutate({ key: existing.key, name: name.trim(), blurb: blurb.trim() }, { onSuccess: onClose });
    } else {
      create.mutate(
        { key: savedKey, name: name.trim(), blurb: blurb.trim(), startFrom: startFrom || null },
        { onSuccess: onClose }
      );
    }
  };

  return (
    <Modal labelledBy="dept-title" onClose={onClose} dismissible={!mutation.isPending}>
      <h2 id="dept-title">{existing ? `Edit ${existing.name}` : "Add a department"}</h2>
      <p className="modal-sub">
        {existing
          ? "Its key stays the same: cases and links refer to it."
          : "It starts with no questions: its admins set them up, and it takes applications once it has some. You can also start from a copy of another department's questions."}
      </p>
      <form
        className="admin-dept-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="dept-name">
            Name
          </label>
          <input
            id="dept-name"
            className="input"
            value={name}
            maxLength={120}
            autoFocus
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </div>
        {!existing && (
          <div className="field">
            <label className="field-label" htmlFor="dept-key">
              Key
            </label>
            <input
              id="dept-key"
              className="input"
              value={shownKey}
              maxLength={32}
              aria-describedby="dept-key-hint"
              aria-invalid={errors.key ? true : undefined}
              onChange={(e) => {
                setKeyTyped(true);
                setKey(keyTyping(e.target.value));
              }}
            />
            <span className="field-hint" id="dept-key-hint">
              Lower-case letters, numbers and hyphens; it cannot be changed later.
            </span>
            {errors.key && <span className="field-error">{errors.key}</span>}
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="dept-blurb">
            Description <span className="admin-muted">(optional)</span>
          </label>
          <input id="dept-blurb" className="input" value={blurb} maxLength={200} onChange={(e) => setBlurb(e.target.value)} />
        </div>
        {!existing && (
          <div className="field">
            <label className="field-label" htmlFor="dept-start">
              Its questions
            </label>
            <select id="dept-start" className="input" value={startFrom} onChange={(e) => setStartFrom(e.target.value)}>
              <option value="">No questions (set them up afterwards)</option>
              {departments
                .filter((d) => d.questionCount > 0)
                .map((d) => (
                  <option key={d.key} value={d.key}>
                    A copy of {d.name}'s questions
                  </option>
                ))}
            </select>
            {errors.startFrom && <span className="field-error">{errors.startFrom}</span>}
          </div>
        )}
        {errors.detail && (
          <p className="field-error" role="alert">
            {errors.detail}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready || mutation.isPending}>
            {mutation.isPending ? "Saving…" : existing ? "Save" : "Add department"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

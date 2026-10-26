import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useCreateAssessment, useDepartments, usePrefill, useSession } from "../api/queries";
import { ApiError } from "../api/client";
import { newAssessmentFields, normaliseNewAssessment, validateNewAssessment } from "../domain/newAssessment";
import { todayIso } from "../utils/format";
import { routes } from "../routes";
import PageHeader from "../components/PageHeader";
import { Loading, LoadError } from "../components/LoadState";
import { AlertTriangleIcon, ArrowLeftIcon, InfoIcon, PlusIcon } from "../components/icons";
import type { NewAssessmentField, NewAssessmentFieldDef, NewAssessmentInput, NewAssessmentMode } from "../domain/newAssessment";
import type { QueueNotice } from "../routes";

const FORM_ID = "new-assessment-form";

type FieldErrors = Partial<Record<NewAssessmentField, string>>;

/** The server's word on each field it refused, such as a reference already assessed. */
function serverFieldErrors(error: unknown, fields: NewAssessmentFieldDef[]): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  const errors: FieldErrors = {};
  for (const def of fields) {
    const message = error.field(def.key);
    if (message) errors[def.key] = message;
  }
  return errors;
}

/**
 * What to say under the form about a refusal no shown field explains: the server's own words
 * (too many open applications, a throttle, a field this form does not show), or a lost connection.
 */
function formErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status < 500) {
    if (typeof error.body.detail === "string") return error.body.detail;
    for (const key of Object.keys(error.body)) {
      const message = error.field(key);
      if (message) return message;
    }
  }
  return "Check your connection and try again.";
}

/**
 * Opens an assessment: the reviewer for an applicant, or an applicant for themselves, who then
 * goes straight on to the form. Errors show once a field has been left, or for every field after
 * a submit attempt, so an untouched form is not covered in red.
 */
export default function NewAssessmentPage({ mode }: { mode: NewAssessmentMode }) {
  const navigate = useNavigate();
  const today = todayIso();
  const user = useSession().data;
  const email = user?.email ?? "";
  const departments = useDepartments();
  // An applicant whose details are on record finds the form filled in with them.
  const prefillWanted = mode === "applicant" && user?.role === "applicant";
  const prefill = usePrefill(prefillWanted);
  const create = useCreateAssessment();
  const fields = newAssessmentFields(mode);
  const byApplicant = mode === "applicant";
  const [input, setInput] = useState<NewAssessmentInput>({
    applicantName: "",
    email: "",
    department: "",
    entity: "",
    position: "",
    reference: "",
    initiatedOn: today,
  });
  const [touched, setTouched] = useState<ReadonlySet<NewAssessmentField>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  // A refusal that names no field on this form (a lost connection, or too many open
  // applications) is reported under the form. Editing a field does not bring it back.
  const [formError, setFormError] = useState("");
  // Filled in once, when the details arrive; from then on the fields are the applicant's to change.
  const [prefilled, setPrefilled] = useState(false);
  const onRecord = prefill.data?.prefill ?? null;
  if (onRecord && !prefilled) {
    setPrefilled(true);
    setInput((prev) => ({
      ...prev,
      // Only what is on record; anything left blank there stays for the applicant to fill in.
      ...Object.fromEntries(Object.entries(onRecord).filter(([, value]) => value)),
    }));
  }

  // The reviewer opens assessments for applicants from their own page.
  if (byApplicant && user?.role === "reviewer") return <Navigate to={routes.reviewerNewAssessment()} replace />;
  // Waits for the details on record (if any), so the form does not change under the applicant;
  // if they cannot be read, the form simply starts empty, as for anyone else.
  if (departments.isPending || (prefillWanted && prefill.isPending)) return <Loading />;
  if (departments.isError && !departments.data) return <LoadError error={departments.error} onRetry={departments.refetch} />;

  const chosen = departments.data.find((d) => d.key === input.department);
  const errors = validateNewAssessment(input, today, fields);
  const visibleError = (key: NewAssessmentField) =>
    (attempted || touched.has(key) ? errors[key] : undefined) ?? serverErrors[key];
  const back = byApplicant ? routes.assessments() : routes.reviewer();

  const change = (key: NewAssessmentField, value: string) => {
    setInput((prev) => ({ ...prev, [key]: value }));
    // The server's objection was to the old value.
    if (serverErrors[key]) setServerErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    const firstInvalid = fields.find((def) => errors[def.key]);
    if (firstInvalid) {
      document.getElementById(`new-${firstInvalid.key}`)?.focus();
      return;
    }
    setFormError("");
    const clean = normaliseNewAssessment(input);
    // Only the fields this form asks for: an applicant applies as themselves, dated today.
    const body = Object.fromEntries(fields.map((def) => [def.key, clean[def.key]]));
    create.mutate(body, {
      onSuccess: (created) => {
        if (byApplicant) {
          // Replaces the form in the history, so Back does not reopen it to start a second one.
          navigate(routes.apply(created.id), { replace: true });
          return;
        }
        const state: QueueNotice = {
          notice: `Assessment ${created.id} opened for ${created.applicantName}. They see it the next time they sign in as ${created.applicantEmail}, and it appears in this queue once they submit it.`,
        };
        navigate(routes.reviewer(), { state, replace: true });
      },
      onError: (error) => {
        const refused = serverFieldErrors(error, fields);
        setServerErrors(refused);
        const first = fields.find((def) => refused[def.key]);
        if (first) document.getElementById(`new-${first.key}`)?.focus();
        else setFormError(formErrorText(error));
      },
    });
  };

  return (
    <div className="page">
      <PageHeader
        title={byApplicant ? "Start a new application" : "New assessment"}
        sub={
          byApplicant ? (
            <>
              Apply for a fit and proper assessment with the department handling your application.
              You fill in the form next; nothing is sent for review until you submit it.
            </>
          ) : (
            <>
              Open a fit and proper assessment against an application. The applicant fills it in
              from their own portal.
            </>
          )
        }
      />

      {byApplicant && prefilled && (
        <div className="notice notice-info" role="status">
          <InfoIcon size={17} />
          <div>
            <strong>We've filled in your application details from our records.</strong> Check them
            before continuing; you can change any of them.
          </div>
        </div>
      )}

      <form className="card section" id={FORM_ID} onSubmit={submit} noValidate>
        <h2 className="section-head-wrap">
          <div className="section-head section-head-static">
            <span className="section-title">{byApplicant ? "Application details" : "Assessment details"}</span>
            <span className="section-count">{byApplicant ? `You apply as ${email}` : chosen?.name}</span>
          </div>
        </h2>
        <div className="section-body field-section">
          <div className="field-grid">
            {fields.map((def) => {
              const id = `new-${def.key}`;
              const error = visibleError(def.key);
              // A chosen department describes itself under the field.
              const hint = def.key === "department" ? chosen?.blurb : def.hint;
              const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ");
              const common = {
                id,
                className: "input",
                value: input[def.key],
                required: true,
                "aria-invalid": error ? true : undefined,
                "aria-describedby": describedBy || undefined,
                onBlur: () => setTouched((prev) => (prev.has(def.key) ? prev : new Set(prev).add(def.key))),
              };
              return (
                <div className="field" key={def.key}>
                  <label className="field-label" htmlFor={id}>
                    {def.label}
                    <span className="required-mark" aria-hidden="true">
                      *
                    </span>
                  </label>
                  {def.input === "select" ? (
                    <select {...common} onChange={(e) => change(def.key, e.target.value)}>
                      <option value="" disabled>
                        Choose a department
                      </option>
                      {/* A department switched off, or with no questions yet, takes no applications. */}
                      {departments.data
                        .filter((d) => d.isActive !== false && d.hasQuestions !== false)
                        .map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      {...common}
                      type={def.input}
                      placeholder={def.placeholder}
                      max={def.input === "date" ? today : undefined}
                      onChange={(e) => change(def.key, e.target.value)}
                    />
                  )}
                  {error ? (
                    <p className="field-error" id={`${id}-error`}>
                      {error}
                    </p>
                  ) : (
                    hint && (
                      <p className="field-hint" id={`${id}-hint`}>
                        {hint}
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </form>

      {formError && (
        <div className="notice notice-critical" role="alert">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>{byApplicant ? "The application was not started." : "The assessment could not be saved."}</strong>{" "}
            {formError}
          </div>
        </div>
      )}

      <footer className="actionbar">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(back)}>
          <ArrowLeftIcon size={15} />
          {byApplicant ? "Back to your assessments" : "Back to the queue"}
        </button>
        <button type="submit" form={FORM_ID} className="btn btn-primary" disabled={create.isPending}>
          <PlusIcon size={15} />
          {byApplicant
            ? create.isPending
              ? "Starting…"
              : "Start application"
            : create.isPending
              ? "Creating…"
              : "Create assessment"}
        </button>
      </footer>
    </div>
  );
}

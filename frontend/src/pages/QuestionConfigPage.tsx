import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  giveBackQuestionnaireLock,
  takeQuestionnaireLock,
  useDepartments,
  useQuestionnaire,
  useQuestionnaireImpact,
  useSaveQuestionnaire,
  useSession,
} from "../api/queries";
import { isSuperUser } from "../state/access";
import { formatDateTime } from "../utils/format";
import { ApiError } from "../api/client";
import type { Department, QuestionnaireSettings } from "../api/types";
import EmptyState from "../components/EmptyState";
import { displaySection } from "../domain/sectionLabels";
import {
  TOTAL,
  blankQuestion,
  changeSummary,
  evenSplit,
  fromVersion,
  hundredths,
  newKey,
  pctTotal,
  questionProblem,
  remainder,
  shareStatus,
  show,
  toBody,
  undoEdits,
  weightsOf,
} from "../domain/questionWeights";
import type { EditQuestion, EditSection, QuestionSettingsDraft } from "../domain/questionWeights";
import { queueUrl } from "../state/queueReturn";
import { Loading, LoadError } from "../components/LoadState";
import Modal from "../components/Modal";
import WeightBar from "../components/questionConfig/WeightBar";
import QuestionRow from "../components/questionConfig/QuestionRow";
import QuestionEditPanel from "../components/questionConfig/QuestionEditPanel";
import ChangeSummaryDialog from "../components/questionConfig/ChangeSummaryDialog";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  InfoIcon,
  PlusIcon,
  SlidersIcon,
  XIcon,
} from "../components/icons";

/** This browser tab, to the editing lock: another tab of the same admin is told apart from it. */
const TAB_TOKEN =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** How often an open editor keeps its lock alive, and a read-only one checks whether it is free. */
const LOCK_KEEP_ALIVE_MS = 60 * 1000;
const LOCK_RECHECK_MS = 20 * 1000;

/** A refusal over the editing lock (someone else, or another tab, is editing), not over the settings. */
const isLockRefusal = (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === "lock_held";

/** How long to wait before asking for the lock again after a request that did not get through. */
const LOCK_RETRY_MS = 5 * 1000;

/** The messages from a refused save, or the general one. */
function saveErrorText(error: unknown): string {
  if (isLockRefusal(error)) return (error as ApiError).message;
  if (error instanceof ApiError && error.status === 409) {
    return "Another reviewer changed the settings in the meantime. Their settings are shown now; make your changes again.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "You do not work on this department any more. Reload the page to see the departments you work on.";
  }
  if (error instanceof ApiError && error.status === 503) {
    return "The AI engine's document types could not be read. Try again shortly.";
  }
  if (error instanceof ApiError && error.status === 400) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(error.body)) {
      if (key === "sections" && value && typeof value === "object" && !Array.isArray(value)) {
        for (const [name, message] of Object.entries(value as Record<string, string>)) {
          parts.push(`${displaySection(name)}: ${message}`);
        }
      } else if (key === "detail") {
        parts.push(String(value));
      } else if (key.startsWith("questions.")) {
        parts.push(`${key.slice("questions.".length)}: ${String(value)}`);
      }
    }
    return parts.length > 0 ? parts.join(" ") : "Some settings are not valid. Check them and try again.";
  }
  return "Check your connection and try again.";
}

export default function QuestionConfigPage() {
  // Each department has its own questions. The one being configured is in the address
  // (?department=), so a reload or a link keeps it; by default the first the reviewer works on.
  const [params, setParams] = useSearchParams();
  const departments = useDepartments();
  const department = params.get("department") || departments.data?.[0]?.key || "";
  const questionnaire = useQuestionnaire(department, TAB_TOKEN);
  // Held here so the outcome of a save outlives the editor's remount onto the new version.
  const save = useSaveQuestionnaire();
  if (departments.isPending) return <Loading />;
  if (departments.isError && !departments.data) return <LoadError error={departments.error} onRetry={departments.refetch} />;
  if (!department) {
    return (
      <div className="page">
        <EmptyState icon={<SlidersIcon size={22} />} title="No department to configure">
          You do not work on any department yet. The super user can give you one.
        </EmptyState>
      </div>
    );
  }
  const choose = (key: string) => {
    save.reset();
    setParams(
      (p) => {
        p.set("department", key);
        return p;
      },
      { replace: true }
    );
  };
  if (questionnaire.isPending) return <Loading />;
  if (questionnaire.error instanceof ApiError && [403, 404].includes(questionnaire.error.status)) {
    // A link to a department this reviewer does not work on (or one that does not exist).
    const own = departments.data[0];
    return (
      <div className="page">
        <EmptyState icon={<SlidersIcon size={22} />} title="Not one of your departments">
          You can configure the questions of the departments you work on only.
          {own && (
            <>
              {" "}
              <button type="button" className="link-button" onClick={() => choose(own.key)}>
                Open {own.name}'s questions
              </button>
            </>
          )}
        </EmptyState>
      </div>
    );
  }
  if (questionnaire.isError && !questionnaire.data) return <LoadError error={questionnaire.error} onRetry={questionnaire.refetch} />;
  // Keyed on the department and version so another department, or a newly published version,
  // starts the editor from its own settings.
  return (
    <QuestionConfigEditor
      key={`${questionnaire.data.department.key}:${questionnaire.data.current.version}`}
      {...questionnaire.data}
      departments={departments.data}
      onDepartment={choose}
      onRecheck={() => questionnaire.refetch()}
      save={save}
    />
  );
}

type Confirm =
  | { kind: "leave" }
  | { kind: "switch"; department: string }
  | { kind: "restore" }
  | { kind: "deleteSection"; sectionKey: string }
  | { kind: "deleteQuestion"; sectionKey: string; questionKey: string };

/** The question open in the edit panel; `isNew` while it was just added and never confirmed. */
interface Editing {
  sectionKey: string;
  questionKey: string;
  isNew: boolean;
}

function QuestionConfigEditor({
  department,
  current,
  published,
  configurableFileTypes,
  evidenceOptionChoices = [],
  engineEvidenceOptions = {},
  checkChoices = [],
  lock,
  departments,
  onDepartment,
  onRecheck,
  save,
}: QuestionnaireSettings & {
  departments: Department[];
  onDepartment: (key: string) => void;
  /** Reads the questions (and who is editing them) again. */
  onRecheck: () => void;
  save: ReturnType<typeof useSaveQuestionnaire>;
}) {
  const navigate = useNavigate();
  const [sections, setSections] = useState<EditSection[]>(() => fromVersion(current));
  const me = useSession().data;

  // ---- One editor at a time ----
  // The first change takes the department's editing lock for this tab; it is kept alive while
  // the editor is open and given back when it is left (or applied). Someone else holding it makes
  // this editor read-only until they finish; the super user, or the same admin in another tab, can
  // take it over.
  // Never assumed from what was read: an editor opening after a refused save starts without the
  // lock (the editor it replaces gives it back as it closes) and takes it again with its first
  // change. A lock still on this tab (`thisTab`) is never mistaken for someone else editing.
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  useEffect(() => {
    holdingRef.current = holding;
  }, [holding]);
  // Taken over by someone else: found by keeping the lock alive, or by a save it refused.
  const [lostLock, setLostLock] = useState<string | null>(null);
  const takenAway = lostLock ?? (isLockRefusal(save.error) ? (save.error as ApiError).message : null);
  const asking = useRef(false);
  // The latest of these, for timers that must not restart on every render.
  const recheckRef = useRef(onRecheck);
  useEffect(() => {
    recheckRef.current = onRecheck;
  }, [onRecheck]);
  const resetSave = save.reset;
  const otherEditor = !holding && lock && !lock.thisTab ? lock : null;
  const readOnly = otherEditor !== null || takenAway !== null;
  // A request for the lock that did not get through (no connection, a server error) is made
  // again a few seconds on: the editor never goes on editing without it.
  const [lockRetry, setLockRetry] = useState(0);
  /** Takes the lock for this tab; whether it was got. */
  const takeLock = useCallback(
    async (takeOver = false): Promise<boolean> => {
      if (asking.current) return false;
      asking.current = true;
      try {
        await takeQuestionnaireLock(department.key, TAB_TOKEN, takeOver);
        setHolding(true);
        setLostLock(null);
        resetSave();
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Someone started a moment before: their edit stands, this one is put back.
          setSections(fromVersion(current));
          recheckRef.current();
        } else if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setLostLock("You no longer work on this department, so its questions cannot be changed here.");
        } else {
          window.setTimeout(() => setLockRetry((n) => n + 1), LOCK_RETRY_MS);
        }
        return false;
      } finally {
        asking.current = false;
      }
    },
    [department.key, current, resetSave]
  );
  // The questionnaire as published, in the shape it is sent, to tell whether anything changed.
  const [saved] = useState(() => JSON.stringify(toBody(fromVersion(current))));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // The summary of what applying changes, shown before it is published, with what it reaches on
  // the applications not yet submitted, read as it opens (so the numbers are current).
  const [reviewing, setReviewing] = useState(false);
  const impact = useQuestionnaireImpact(reviewing, department.key);
  // The field a section just added starts in (its name).
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const body = toBody(sections);
  const dirty = JSON.stringify(body) !== saved;
  // The first change takes the lock (a request to the server; its answer sets what follows).
  const wantsLock = dirty && !holding && !readOnly;
  useEffect(() => {
    if (!wantsLock) return;
    const timer = window.setTimeout(() => void takeLock(), 0);
    return () => window.clearTimeout(timer);
  }, [wantsLock, takeLock, lockRetry]);
  // Kept alive while held; if it was taken over meanwhile, this editor stops.
  useEffect(() => {
    if (!holding) return;
    const timer = window.setInterval(async () => {
      try {
        await takeQuestionnaireLock(department.key, TAB_TOKEN);
      } catch (error) {
        // Taken over (409), or no longer this admin's department (403, 404): this editor stops.
        // Anything else (no connection, a server error) is tried again on the next beat.
        if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
          setHolding(false);
          setLostLock(
            error.status === 409
              ? error.message
              : "You no longer work on this department, so its questions cannot be changed here."
          );
          recheckRef.current();
        }
      }
    }, LOCK_KEEP_ALIVE_MS);
    return () => window.clearInterval(timer);
  }, [holding, department.key]);
  // Given back when the editor is left: another page, another department, or the tab closed.
  useEffect(() => {
    const leave = () => {
      if (holdingRef.current) giveBackQuestionnaireLock(department.key, TAB_TOKEN);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [department.key]);
  // Read-only while someone else edits: checked now and then, so it opens up once they finish.
  useEffect(() => {
    if (!otherEditor) return;
    const timer = window.setInterval(() => recheckRef.current(), LOCK_RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [otherEditor]);

  // Closing or reloading the tab with changes not applied asks the browser to confirm.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // The section weights first: until they add up to 100, the questions are locked.
  const sectionWeights = sections.map((s) => hundredths(s.weight));
  const sectionsValid = sectionWeights.every((w) => w !== null);
  const sectionTotal = sectionWeights.reduce<number>((a, b) => a + (b ?? 0), 0);
  const sectionLeft = remainder(sections.map((s) => s.weight));
  const names = sections.map((s) => s.name.trim().toLowerCase());
  const nameProblem = (s: EditSection, i: number) =>
    !s.name.trim() ? "Name the section." : names.indexOf(names[i]) !== i ? "Another section has this name." : null;
  // A section added in this edit starts at 0, the others keeping theirs: it waits for its share.
  const unweighted = sections.filter((s) => s.baseName === null && hundredths(s.weight) === 0);
  const sectionsOk =
    sectionsValid && sectionTotal === TOTAL && unweighted.length === 0 && sections.every((s, i) => !nameProblem(s, i));
  const frozen = !(sectionsValid && sectionTotal === TOTAL);
  const sectionOff = (s: EditSection) => pctTotal(s) !== TOTAL || s.questions.some((q) => questionProblem(q));
  const allOk = sectionsOk && sections.every((s) => !sectionOff(s));

  const updateSection = (key: string, change: Partial<EditSection>) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...change } : s)));
    save.reset();
  };
  const updateQuestion = (sectionKey: string, questionKey: string, change: Partial<EditQuestion>) => {
    setSections((prev) =>
      prev.map((s) =>
        s.key === sectionKey
          ? { ...s, questions: s.questions.map((q) => (q.key === questionKey ? { ...q, ...change } : q)) }
          : s
      )
    );
    save.reset();
  };

  // ---- Sharing out 100 ----
  const splitSections = () => {
    const shares = evenSplit(sections.length);
    setSections((prev) => prev.map((s, i) => ({ ...s, weight: show(shares[i]) })));
    save.reset();
  };
  const fillLastSection = () => {
    if (sectionLeft === null || sectionLeft <= 0 || sections.length === 0) return;
    const last = sections[sections.length - 1];
    updateSection(last.key, { weight: show((hundredths(last.weight) ?? 0) + sectionLeft) });
  };
  const splitQuestions = (section: EditSection) => {
    const shares = evenSplit(section.questions.length);
    updateSection(section.key, { questions: section.questions.map((q, i) => ({ ...q, pct: show(shares[i]) })) });
  };
  const fillLastQuestion = (section: EditSection, left: number) => {
    const last = section.questions[section.questions.length - 1];
    if (!last || left <= 0) return;
    updateQuestion(section.key, last.key, { pct: show((hundredths(last.pct) ?? 0) + left) });
  };

  // ---- Adding and removing ----
  const addSection = () => {
    // The other sections keep their weights; the new one starts at 0, and the reviewer gives it
    // its share by lowering the others (told so above), so the weights still add up to 100.
    const key = newKey();
    setSections((prev) => [
      ...prev,
      {
        key,
        name: `New section ${prev.length + 1}`,
        baseName: null,
        // The first section of a department with no questions yet takes the whole 100.
        weight: prev.length === 0 ? "100" : "0",
        baseWeight: null,
        baseCount: 0,
        questions: [blankQuestion("100")],
      },
    ]);
    setFocusKey(`section:${key}`);
    save.reset();
  };
  const addQuestion = (sectionKey: string) => {
    const question = blankQuestion();
    setSections((prev) =>
      prev.map((s) => (s.key === sectionKey ? { ...s, questions: [...s.questions, question] } : s))
    );
    // Its settings are filled in in the panel; cancelling there takes it away again.
    setEditing({ sectionKey, questionKey: question.key, isNew: true });
    save.reset();
  };
  /** Removes a section; any weight it had is then left to share between the others. */
  const removeSection = (sectionKey: string) => {
    setSections((prev) => prev.filter((s) => s.key !== sectionKey));
    save.reset();
  };
  const removeQuestion = (sectionKey: string, questionKey: string) => {
    setSections((prev) =>
      prev.map((s) => (s.key === sectionKey ? { ...s, questions: s.questions.filter((q) => q.key !== questionKey) } : s))
    );
    save.reset();
  };
  const doDelete = () => {
    if (confirm?.kind === "deleteSection") removeSection(confirm.sectionKey);
    else if (confirm?.kind === "deleteQuestion") removeQuestion(confirm.sectionKey, confirm.questionKey);
    setConfirm(null);
  };

  // ---- The edit panel ----
  const editingSection = editing ? sections.find((s) => s.key === editing.sectionKey) : undefined;
  const editingQuestion = editingSection?.questions.find((q) => q.key === editing?.questionKey);
  const closePanel = (settings?: QuestionSettingsDraft) => {
    if (!editing) return;
    if (settings) {
      updateQuestion(editing.sectionKey, editing.questionKey, settings);
    } else if (editing.isNew) {
      // Cancelled straight after adding it: the question goes again.
      removeQuestion(editing.sectionKey, editing.questionKey);
    }
    setEditing(null);
  };

  // ---- Applying ----
  const apply = () => {
    if (!allOk) return;
    // A change is shown first, to be confirmed; with none, applying publishes nothing.
    if (dirty) setReviewing(true);
    else save.mutate({ department: department.key, version: current.version, lockToken: TAB_TOKEN, sections: body });
  };
  const confirmApply = () => {
    save.mutate(
      { department: department.key, version: current.version, lockToken: TAB_TOKEN, sections: body },
      { onSettled: () => setReviewing(false) }
    );
  };
  const restore = async () => {
    setConfirm(null);
    // Restoring changes the questions like any edit: the lock is taken first, and nothing is
    // restored while someone else holds it.
    if (!holding && !(await takeLock())) return;
    const restored = fromVersion(published);
    setSections(restored);
    save.mutate({ department: department.key, version: current.version, lockToken: TAB_TOKEN, sections: toBody(restored) });
  };
  const leave = () => (dirty ? setConfirm({ kind: "leave" }) : navigate(queueUrl()));

  const questionCount = sections.reduce((n, s) => n + s.questions.length, 0);
  const confirmTarget =
    confirm?.kind === "deleteSection"
      ? sections.find((s) => s.key === confirm.sectionKey)
      : confirm?.kind === "deleteQuestion"
        ? sections.find((s) => s.key === confirm.sectionKey)?.questions.find((q) => q.key === confirm.questionKey)
        : undefined;
  const sectionStatus = shareStatus(sectionLeft, "");

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Question configuration</h1>
          <p className="page-sub">
            {questionCount === 0
              ? `${department.name} has no questions yet. Each department has its own questions.`
              : `${department.name}: its sections, their weights, and the weight, answer options and attachment rules of each of its ${questionCount} questions. Each department has its own questions.`} Changes reach {department.name} applicants who have not submitted yet — an
            assessment already submitted keeps the configuration it was scored against.
          </p>
        </div>
        <div className="page-head-aside">
          {departments.length > 1 && (
            <div className="qconfig-department">
              <label className="field-label" htmlFor="qconfig-department">
                Department
              </label>
              <select
                id="qconfig-department"
                className="input"
                value={department.key}
                onChange={(e) => {
                  const key = e.target.value;
                  // Unapplied changes are asked about first, as leaving the page would.
                  if (dirty) setConfirm({ kind: "switch", department: key });
                  else onDepartment(key);
                }}
              >
                {departments.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                    {d.isActive === false ? " (switched off)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {sections.length > 0 && (
            <span className={`chip ${sectionTotal === TOTAL && sectionsValid ? "chip-low" : "chip-critical"}`}>
              Total weight {sectionsValid ? show(sectionTotal) : "—"} of 100
            </span>
          )}
        </div>
      </header>

      {save.isSuccess && (
        <div className="notice notice-good">
          <CheckCircleIcon size={17} />
          <div>
            <strong>Configuration applied.</strong> It takes effect for every {department.name}{" "}
            assessment that has not been submitted yet.
          </div>
        </div>
      )}

      {save.isError && (
        <div className="notice notice-critical" role="alert">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>The configuration was not applied.</strong> {saveErrorText(save.error)}
          </div>
        </div>
      )}

      <div className="notice notice-info">
        <InfoIcon size={17} />
        <div>
          Weight drives the risk score. The section weights add up to 100. Within a section, give
          each question a percentage of the section's weight — its weight follows from that, and the
          percentages add up to 100%. The weights go to the AI engine with each submission. Choose
          Edit on a question to change its text, how it is answered, what counts as a risk and the
          evidence it takes.
        </div>
      </div>

      {otherEditor && !takenAway && (
        <div className="notice notice-info qconfig-lock" role="status">
          <InfoIcon size={17} />
          <div>
            {otherEditor.email === me?.email ? (
              <>
                <strong>You are editing these questions in another tab.</strong> Carry on there, or edit
                them here instead (the other tab's changes not yet applied are then left behind).
              </>
            ) : (
              <>
                <strong>
                  {otherEditor.email} is editing these questions (since {formatDateTime(otherEditor.since)}).
                </strong>{" "}
                You can read them; they can be changed once {otherEditor.email} applies or leaves. This page
                checks every few seconds.
              </>
            )}
          </div>
          {(otherEditor.email === me?.email || isSuperUser(me)) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void takeLock(true)}>
              {otherEditor.email === me?.email ? "Edit here instead" : "Take over editing"}
            </button>
          )}
        </div>
      )}

      {takenAway && (
        <div className="notice notice-critical" role="alert">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>You are no longer editing these questions.</strong> {takenAway} Your changes that were
            not applied are still shown, to note; reload the page to see the questions as they are now.
          </div>
        </div>
      )}

      <fieldset className="qconfig-lockable" disabled={readOnly}>
        <legend className="sr-only">Questions of {department.name}</legend>
      {sections.length === 0 && (
        // A department with no questions yet: it takes applications once some are applied.
        <EmptyState
          icon={<SlidersIcon size={22} />}
          title={`${department.name} has no questions yet`}
          action={
            <button type="button" className="btn btn-primary" onClick={addSection}>
              <PlusIcon size={15} />
              Add the first section
            </button>
          }
        >
          It takes no applications until its questions are set up. Add the first section, then its
          questions, and apply.
        </EmptyState>
      )}

      {/* The questionnaire at a glance: each section's share of 100. */}
      {sections.length > 0 && (
        <section className="card qoverview" aria-label="Section weights">
          <div className="qoverview-head">
            <span className="section-title">Section weights</span>
            <span className={`qstatus is-${sectionStatus.tone}`} role="status">
              {sectionStatus.tone === "ok" && <CheckCircleIcon size={13} />}
              {sectionStatus.tone !== "ok" && <AlertTriangleIcon size={13} />}
              {sectionsValid ? `${show(sectionTotal)} of 100 · ` : ""}
              {sectionStatus.text}
            </span>
            <span className="qoverview-actions">
              {sectionLeft !== null && sectionLeft > 0 && sections.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={fillLastSection}>
                  Give the remaining {show(sectionLeft)} to {sections[sections.length - 1].name || "the last section"}
                </button>
              )}
              {sections.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={splitSections}>
                  Split equally
                </button>
              )}
            </span>
          </div>
          <WeightBar
            legend
            unit="%"
            label="How the 100 is shared between the sections"
            parts={sections.map((s) => ({
              key: s.key,
              label: s.name || "New section",
              value: hundredths(s.weight) ?? 0,
              onSelect: () => document.getElementById(`section-${s.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
            }))}
          />
        </section>
      )}

      {sections.length === 0 ? null : frozen ? (
        <div className="notice notice-warning" role="status">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>The section weights must add up to 100.</strong> They add up to{" "}
            {sectionsValid ? show(sectionTotal) : "—"} now; change them so they come to 100.
            The questions are locked until the section weights add up to 100.
          </div>
        </div>
      ) : (
        unweighted.length > 0 && (
          <div className="notice notice-warning" role="status">
            <AlertTriangleIcon size={17} />
            <div>
              <strong>
                {unweighted.map((s) => `"${s.name || "New section"}"`).join(", ")}{" "}
                {unweighted.length === 1 ? "has" : "have"} no weight yet.
              </strong>{" "}
              The other sections keep their weights, and all section weights must add up to 100.
              Lower the other sections' weights and give the new section its share — type the
              numbers yourself, or use Split equally above.
            </div>
          </div>
        )
      )}

      {sections.map((section, si) => {
        const weights = weightsOf(section);
        const pctSum = pctTotal(section);
        const left = remainder(section.questions.map((q) => q.pct));
        const status = shareStatus(left, "%");
        const off = !frozen && sectionOff(section);
        const sectionWeight = hundredths(section.weight);
        const sectionWeightInvalid = sectionWeight === null;
        const needsWeight = unweighted.includes(section);
        // How much of the section's weight its questions take between them.
        const used = sectionWeight !== null && pctSum !== null ? Math.round((sectionWeight * pctSum) / TOTAL) : null;
        const nameError = nameProblem(section, si);
        const checkId = `pcheck-${section.key}`;
        return (
          <section
            id={`section-${section.key}`}
            className={`card section qsection${frozen ? " is-frozen" : ""}${off || nameError ? " is-off" : ""}`}
            key={section.key}
            aria-label={section.name || "Section"}
          >
            <div className="qsection-head">
              <div className="qconfig-field qsection-name">
                <label className="field-label" htmlFor={`sname-${section.key}`}>
                  Section
                </label>
                <input
                  id={`sname-${section.key}`}
                  className="input"
                  value={section.name}
                  maxLength={120}
                  autoFocus={focusKey === `section:${section.key}`}
                  aria-invalid={nameError ? true : undefined}
                  onChange={(e) => updateSection(section.key, { name: e.target.value })}
                />
                {nameError && <span className="field-error">{nameError}</span>}
              </div>
              <div className="qconfig-field qsection-weight">
                <label className="field-label" htmlFor={`sweight-${section.key}`}>
                  Section weight
                </label>
                <input
                  id={`sweight-${section.key}`}
                  className="input input-num"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="any"
                  value={section.weight}
                  aria-invalid={sectionWeightInvalid || frozen || needsWeight || undefined}
                  aria-describedby={needsWeight ? `sneed-${section.key}` : undefined}
                  onChange={(e) => updateSection(section.key, { weight: e.target.value })}
                />
                {needsWeight && (
                  <span className="field-error" id={`sneed-${section.key}`}>
                    Give this section a weight
                  </span>
                )}
              </div>
              {section.baseName === null ? (
                // Added in this edit: cancelling it takes it away again (asked first only if
                // something was typed in it).
                <button
                  type="button"
                  className="btn btn-ghost btn-sm qsection-delete"
                  onClick={() =>
                    section.questions.some((q) => q.text.trim())
                      ? setConfirm({ kind: "deleteSection", sectionKey: section.key })
                      : removeSection(section.key)
                  }
                >
                  <XIcon size={13} />
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm qsection-delete"
                  disabled={sections.length === 1}
                  title={sections.length === 1 ? "The questionnaire needs at least one section" : undefined}
                  onClick={() => setConfirm({ kind: "deleteSection", sectionKey: section.key })}
                >
                  <XIcon size={13} />
                  Delete section
                </button>
              )}
            </div>

            <fieldset className="qsection-body" disabled={frozen}>
              <legend className="sr-only">Questions in {section.name}</legend>
              <div className="qsection-share">
                <span className="qsection-uses">
                  Section weight <strong>{sectionWeightInvalid ? "—" : show(sectionWeight)}</strong> of 100 · its
                  questions use <strong>{used === null ? "—" : show(used)}</strong> of it
                </span>
                <WeightBar
                  unit="%"
                  label={`How ${section.name || "the section"} is shared between its questions`}
                  parts={section.questions.map((q) => ({ key: q.key, label: q.qid ?? "New", value: hundredths(q.pct) ?? 0 }))}
                />
                {/* How much of the section is shared out (the percentage fields are described by it).
                    While the questions are locked it waits, neither passed nor failed. */}
                {frozen ? (
                  <span id={checkId} className="qstatus is-waiting">
                    Questions {pctSum === null ? "—" : show(pctSum)}% assigned · waiting for the section weights to add up to 100
                  </span>
                ) : (
                  <span id={checkId} className={`qstatus is-${status.tone}`}>
                    {status.tone === "ok" ? <CheckCircleIcon size={13} /> : <AlertTriangleIcon size={13} />}
                    {status.text}
                    {left !== null && left > 0 && section.questions.length > 0 && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => fillLastQuestion(section, left)}
                      >
                        Give it to {section.questions[section.questions.length - 1].qid ?? "the new question"}
                      </button>
                    )}
                  </span>
                )}
              </div>

              {section.questions.map((q, qi) => (
                <QuestionRow
                  key={q.key}
                  question={q}
                  weight={weights ? weights[qi] : null}
                  sectionWeight={sectionWeight}
                  problem={frozen ? null : questionProblem(q)}
                  checkId={checkId}
                  pctInvalid={!frozen && pctSum !== TOTAL}
                  deleteDisabledReason={
                    section.questions.length === 1 ? "A section needs at least one question; delete the section instead" : null
                  }
                  onPct={(pct) => updateQuestion(section.key, q.key, { pct })}
                  onEdit={() => setEditing({ sectionKey: section.key, questionKey: q.key, isNew: false })}
                  onUndo={() => updateQuestion(section.key, q.key, undoEdits(q))}
                  onDelete={() =>
                    // A question just added and still blank goes at once; others are asked about first.
                    q.qid === null && !q.text.trim()
                      ? removeQuestion(section.key, q.key)
                      : setConfirm({ kind: "deleteQuestion", sectionKey: section.key, questionKey: q.key })
                  }
                />
              ))}

              <div className="qsection-foot">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => addQuestion(section.key)}>
                  <PlusIcon size={14} />
                  Add question
                </button>
                {section.questions.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => splitQuestions(section)}>
                    Split equally
                  </button>
                )}
              </div>
            </fieldset>
          </section>
        );
      })}

      {sections.length > 0 && (
        <div className="qconfig-add-section">
          <button type="button" className="btn btn-ghost" onClick={addSection}>
            <PlusIcon size={15} />
            Add section
          </button>
        </div>
      )}

      {!frozen && !allOk && unweighted.length === 0 && (
        <div className="notice notice-warning" role="status">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>Some settings need attention before applying.</strong> In{" "}
            {sections
              .filter((s, i) => sectionOff(s) || nameProblem(s, i))
              .map((s) => s.name || "an unnamed section")
              .join(", ")}
            , make the percentages add up to 100% and complete the highlighted questions.
          </div>
        </div>
      )}
      </fieldset>

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={leave}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
        {/* A department that started with no questions has nothing to restore. */}
        {published.questions.length > 0 && (
          <button className="btn btn-ghost" disabled={save.isPending || readOnly} onClick={() => setConfirm({ kind: "restore" })}>
            Restore published model
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={save.isPending || !allOk || readOnly}
          title={allOk ? undefined : "Section weights must add up to 100 (each with a weight), and each section's percentages to 100%"}
          onClick={apply}
        >
          <SlidersIcon size={15} />
          {save.isPending ? "Applying…" : "Apply configuration"}
        </button>
      </footer>

      {editing && editingSection && editingQuestion && (
        <QuestionEditPanel
          key={editing.questionKey}
          question={editingQuestion}
          section={editingSection}
          isNew={editing.isNew}
          configurableFileTypes={configurableFileTypes}
          evidenceOptionChoices={evidenceOptionChoices}
          engineEvidenceOptions={engineEvidenceOptions}
          checkChoices={checkChoices}
          onDone={(settings) => closePanel(settings)}
          onCancel={() => closePanel()}
        />
      )}

      {reviewing && (
        <ChangeSummaryDialog
          lines={changeSummary(current, body, impact.data ?? null)}
          drafts={impact.data?.drafts ?? null}
          checking={impact.isPending}
          pending={save.isPending}
          onApply={confirmApply}
          onBack={() => setReviewing(false)}
        />
      )}

      {confirm?.kind === "leave" && (
        <Modal labelledBy="leave-title" onClose={() => setConfirm(null)}>
          <span className="modal-icon">
            <AlertTriangleIcon size={20} />
          </span>
          <h2 id="leave-title">Leave without applying?</h2>
          <p className="modal-sub">
            Your changes to the question configuration have not been applied, and will be lost.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Keep editing
            </button>
            <button className="btn btn-primary" onClick={() => navigate(queueUrl())}>
              Leave without applying
            </button>
          </div>
        </Modal>
      )}

      {confirm?.kind === "switch" && (
        <Modal labelledBy="switch-title" onClose={() => setConfirm(null)}>
          <span className="modal-icon">
            <AlertTriangleIcon size={20} />
          </span>
          <h2 id="switch-title">Switch department without applying?</h2>
          <p className="modal-sub">
            Your changes to {department.name}'s questions have not been applied, and will be lost.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Keep editing
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const key = confirm.department;
                setConfirm(null);
                onDepartment(key);
              }}
            >
              Switch without applying
            </button>
          </div>
        </Modal>
      )}

      {confirm?.kind === "restore" && (
        <Modal labelledBy="restore-title" onClose={() => setConfirm(null)}>
          <span className="modal-icon">
            <AlertTriangleIcon size={20} />
          </span>
          <h2 id="restore-title">Restore the published model?</h2>
          <p className="modal-sub">
            Every section and question of {department.name} goes back to the published model — its
            weights, answer options and attachment rules — and this is applied at once for every{" "}
            {department.name} assessment not submitted yet. Sections and questions added since are
            removed.
            {dirty ? " Your changes not yet applied are discarded." : ""}
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={restore}>
              Restore and apply
            </button>
          </div>
        </Modal>
      )}

      {(confirm?.kind === "deleteSection" || confirm?.kind === "deleteQuestion") && confirmTarget && (
        <Modal labelledBy="delete-title" onClose={() => setConfirm(null)}>
          <span className="modal-icon">
            <AlertTriangleIcon size={20} />
          </span>
          <h2 id="delete-title">
            {confirm.kind === "deleteSection"
              ? `Delete the section "${(confirmTarget as EditSection).name || "New section"}"?`
              : `Delete question ${(confirmTarget as EditQuestion).qid ?? "(new)"}?`}
          </h2>
          <p className="modal-sub">
            {confirm.kind === "deleteSection"
              ? "The section and its questions are removed from the questionnaire once you apply. Share its weight between the other sections so they add up to 100."
              : "The question is removed from the questionnaire once you apply. Share its percentage between the section's other questions so they add up to 100%."}{" "}
            Assessments already submitted keep it.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={doDelete}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}


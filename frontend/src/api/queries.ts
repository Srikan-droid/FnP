/**
 * Server state, through TanStack Query: one cache entry per resource, refreshed after every change
 * that affects it. A change's response is the updated resource, so it is written straight into the
 * cache instead of being fetched again.
 */
import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery, useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, api, sendOnLeave, uploadWithProgress } from "./client";
import type {
  AccountRole,
  AdminDepartment,
  AdminOverview,
  AdminUserDetail,
  AdminUserRow,
  AnswerType,
  Assessment,
  Case,
  Catalogue,
  Department,
  EvidenceItem,
  EvidenceRule,
  Form,
  LibraryDocument,
  Page,
  QuestionnaireImpact,
  QuestionnaireLock,
  QuestionnaireSettings,
  QuestionnaireVersion,
  SessionUser,
  Stage,
  Verdict,
} from "./types";
import type { Answer, EvidenceRole } from "../domain/types";
import type { NewAssessmentInput } from "../domain/newAssessment";
import { toast, type ToastTone } from "../state/toast";

export const keys = {
  session: ["session"] as const,
  /** Set when the backend reported the session had ended; the sign-in page says so. */
  sessionEnded: ["session-ended"] as const,
  catalogue: ["catalogue"] as const,
  questionnaire: ["questionnaire"] as const,
  departments: ["departments"] as const,
  assessments: ["assessments"] as const,
  assessment: (id: string) => ["assessment", id] as const,
  form: (id: string) => ["form", id] as const,
  case: (id: string) => ["case", id] as const,
  admin: ["admin"] as const,
};

/** Stages the engine is still working through; a case page checks back while it is in one. */
const RUNNING: Stage[] = ["AUTH_RUNNING", "SCORING"];
/** How often a case page checks back: as often as the server asks the engine (every 5 seconds). */
const POLL_MS = 5000;
/** How often a list checks back: each check reloads every page of it shown so far. */
const LIST_POLL_MS = 10000;
// Otherwise, every so often: the list is in order of the latest action, so a case acted on elsewhere
// moves to the top, and the pages already loaded are read again to show it there.
const LIST_REFRESH_MS = 30000;

// ---- Session ----------------------------------------------------------------------------------

/**
 * Who is signed in. Checked again whenever the tab comes back into focus: signing in as someone
 * else in another tab changes the session for every tab, and this tab must follow rather than
 * keep showing (and acting as) the previous user.
 */
export function useSession() {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      const { user } = await api<{ user: SessionUser | null }>("GET", "/session");
      const previous = client.getQueryData<SessionUser | null>(keys.session);
      // Someone else now: nothing cached for the previous user may be shown to them.
      if (previous !== undefined && previous?.email !== user?.email) dropOtherUserData(client);
      return user;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: "always",
  });
}

function dropOtherUserData(client: QueryClient) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.session[0] });
  client.getMutationCache().clear();
}

/**
 * Switches the app to another signed-in user, or to nobody. Nothing cached for the previous user
 * may outlive the switch. The session entry is updated in place rather than dropped: the route
 * gates and the header are watching it, and would not notice a fresh entry.
 */
export function switchUser(client: QueryClient, user: SessionUser | null) {
  client.setQueryData(keys.session, user);
  dropOtherUserData(client);
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api<{ user: SessionUser }>("POST", "/session", { email }),
    onSuccess: ({ user }) => switchUser(client, user),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("DELETE", "/session"),
    onSettled: () => switchUser(client, null),
  });
}

// ---- Catalogue and question settings ----------------------------------------------------------

/**
 * The questions and document types an assessment is held to: each department has its own
 * questionnaire, and a submitted assessment keeps the edition it was submitted under.
 */
export function useCatalogue(assessmentId: string, enabled = true) {
  return useQuery({
    queryKey: [...keys.catalogue, assessmentId],
    queryFn: () => api<Catalogue>("GET", `/catalogue?assessment=${encodeURIComponent(assessmentId)}`),
    enabled: enabled && assessmentId !== "",
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The largest document the server accepts, from the assessment's catalogue (the one its page
 * already loads, so no extra request). Undefined until it has arrived.
 */
export function useMaxUploadBytes(assessmentId: string): number | undefined {
  return useCatalogue(assessmentId).data?.maxUploadBytes;
}

/**
 * The question settings. Not read again when the tab regains focus: a newer version would replace
 * the editor's unsaved changes without a word. Another reviewer's change shows when saving (the
 * save is refused as out of date) or on opening the page again.
 */
export function useQuestionnaire(department: string, token: string) {
  return useQuery({
    queryKey: [...keys.questionnaire, department],
    // The tab's token: the editing lock it holds (if any) reads as its own.
    queryFn: () =>
      api<QuestionnaireSettings>(
        "GET",
        `/questionnaire?department=${encodeURIComponent(department)}&token=${encodeURIComponent(token)}`
      ),
    enabled: department !== "",
    refetchOnWindowFocus: false,
  });
}

/**
 * What applying a change would reach on the applications not yet submitted. Read when the
 * reviewer is about to apply (enabled), never kept: applicants keep filling in forms meanwhile.
 */
export function useQuestionnaireImpact(enabled: boolean, department: string) {
  return useQuery({
    queryKey: [...keys.questionnaire, department, "impact"],
    queryFn: () =>
      api<QuestionnaireImpact>("GET", `/questionnaire/impact?department=${encodeURIComponent(department)}`),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * The editing lock on a department's questions, for this browser tab (`token`): taken when the
 * first change is made, kept alive while the editor is open, given back when it is left. Refused
 * (409, with who is editing) while someone else holds it; `takeOver` takes it from another tab of
 * the same admin or, for the super user, from another admin.
 */
export const takeQuestionnaireLock = (department: string, token: string, takeOver = false) =>
  api<{ lock: QuestionnaireLock }>("POST", "/questionnaire/lock", { department, token, takeOver });

export const giveBackQuestionnaireLock = (department: string, token: string) =>
  sendOnLeave(
    "DELETE",
    `/questionnaire/lock?department=${encodeURIComponent(department)}&token=${encodeURIComponent(token)}`
  );

export type QuestionSettings = Record<
  string,
  { allowedAnswers: Answer[]; fileTypes: string[]; maxFiles: number; weight?: number }
>;

/** The whole questionnaire as edited: its sections in order, each with its questions (qid null: added). */
export interface SectionEdit {
  name: string;
  weight: number;
  questions: {
    qid: string | null;
    text: string;
    polarity: "Positive" | "Negative";
    answerType: AnswerType;
    weight: number;
    allowedAnswers: Answer[];
    fileTypes: string[];
    maxFiles: 1 | 2;
    evidenceRequired: EvidenceRule;
    evidenceOptions: string[];
    /** The checks the engine runs on its documents (none for a question that takes none). */
    checks: string[];
  }[];
}

/**
 * Publishes settings edited from `version` (refused, 409, if someone has published since): the
 * whole questionnaire (`sections`), or only some questions' settings (`questions`).
 */
export function useSaveQuestionnaire() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: keys.questionnaire });
    client.invalidateQueries({ queryKey: keys.catalogue });
  };
  return useMutation({
    mutationFn: (edit: {
      department: string;
      version: string;
      /** The tab holding the editing lock. */
      lockToken?: string;
      questions?: QuestionSettings;
      sections?: SectionEdit[];
    }) =>
      api<QuestionnaireVersion>("PUT", "/questionnaire", edit),
    onSuccess: (published, { department }) => {
      // The page moves onto the published version at once, so a follow-up save builds on it.
      // Applying gave the editing lock back (the server dropped it), so the editor that opens on
      // the new version starts without it.
      client.setQueryData<QuestionnaireSettings>(
        [...keys.questionnaire, department],
        (old) => old && { ...old, current: published, lock: null }
      );
      refresh();
    },
    // Refused as out of date: load the settings now in force.
    onError: (error) => error instanceof ApiError && error.status === 409 && refresh(),
  });
}

// ---- Assessments ------------------------------------------------------------------------------

/** The application details on record for the signed-in applicant (null for anyone with none). */
export type Prefill = Pick<NewAssessmentInput, "applicantName" | "department" | "entity" | "position" | "reference">;

/**
 * What "Start a new application" is filled in with for an applicant whose details are on record.
 * Read fresh each time the page opens: the reference offered moves on once one is used.
 */
export function usePrefill(enabled: boolean) {
  return useQuery({
    queryKey: ["prefill"],
    queryFn: () => api<{ prefill: Prefill | null }>("GET", "/assessments/prefill"),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * The departments: for an applicant those taking applications, for a reviewer the ones they work
 * on. The super user can switch one off or change an admin's departments at any time, so the list
 * is read again when it is a minute old and the tab comes back into focus.
 */
export function useDepartments() {
  return useQuery({
    queryKey: keys.departments,
    queryFn: () => api<Department[]>("GET", "/departments"),
    staleTime: 60 * 1000,
  });
}

/**
 * The applicant's own assessments, or the reviewer's queue, a page at a time. The reviewer can
 * narrow the queue to one department and/or one stage.
 */
export function useAssessments(
  department = "",
  stage = "",
  search = "",
  { live = false, holder = "" }: { live?: boolean; holder?: string } = {}
) {
  const { data: user } = useSession();
  return useInfiniteQuery({
    queryKey: [...keys.assessments, department, stage, search, holder],
    // Signed out, there is nothing to list (the page sends the user to sign in).
    enabled: Boolean(user),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (department) params.set("department", department);
      if (holder) params.set("holder", holder);
      if (stage) params.set("stage", stage);
      if (search) params.set("q", search);
      if (pageParam) params.set("cursor", pageParam);
      const query = params.toString();
      return api<Page<Assessment>>("GET", `/assessments${query ? `?${query}` : ""}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
    // Switching the department filter keeps the current list on screen until the new one arrives.
    placeholderData: (previous) => previous,
    // The list reflects running engine jobs; refresh it while any listed case is still running.
    // A live list (the reviewer's queue, in order of the latest action) is also read again every
    // so often, while it is on screen, so a case acted on elsewhere moves to the top.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.results.some((a) => RUNNING.includes(a.stage)))
        ? LIST_POLL_MS
        : live
          ? LIST_REFRESH_MS
          : false,
  });
}

/** One assessment; pass undefined to skip (the hook must still be called unconditionally). */
export function useAssessment(id: string | undefined) {
  return useQuery({
    queryKey: keys.assessment(id ?? ""),
    queryFn: () => api<Assessment>("GET", `/assessments/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateAssessment() {
  const client = useQueryClient();
  return useMutation({
    // The reviewer sends every field; an applicant sends neither email nor date (see newAssessmentFields).
    mutationFn: (input: Partial<NewAssessmentInput>) => api<Assessment>("POST", "/assessments", input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.assessments }),
    // Refused over the department (switched off meanwhile, say): the list is read again.
    onError: (error) => {
      if (error instanceof ApiError && error.field("department")) client.invalidateQueries({ queryKey: keys.departments });
    },
  });
}

/**
 * An applicant starts a new application from a decided one of theirs: the same details, a new
 * reference, and the questions to fill in afresh. Takes the decided application's id.
 */
export function useContinueApplication() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (fromId: string) => api<Assessment>("POST", `/assessments/${fromId}/continue`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.assessments }),
  });
}

export function useRemoveAssessment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("DELETE", `/assessments/${id}`),
    onSuccess: () => {
      client.removeQueries({ queryKey: keys.assessment(id) });
      client.removeQueries({ queryKey: keys.case(id) });
      client.invalidateQueries({ queryKey: keys.assessments });
      toast("Application removed.");
    },
  });
}

// ---- The applicant's form ---------------------------------------------------------------------

/** The form; pass enabled=false to skip it until it is needed (the hook must still be called). */
export function useForm(id: string, enabled = true) {
  return useQuery({ queryKey: keys.form(id), queryFn: () => api<Form>("GET", `/assessments/${id}/form`), enabled });
}

export interface FormChanges {
  /** Yes, No or N/A for a choice question; the words for a text question. */
  answers?: Record<string, string>;
}

/** A save the server refused, and the change it carried. */
export interface SaveRefusal {
  error: unknown;
  changes: FormChanges;
}

/**
 * Saves answers. The change shows at once. Several saves can be waiting (one per field
 * left); they are sent one at a time, in the order they were made, so the server applies them in
 * that order and the last to finish carries the server's copy after all of them. Only that one
 * settles the form: with the server's copy if it saved, or by reloading it if it was refused.
 *
 * Every refusal is reported in `refusal`, not only the last: a later save that succeeds would
 * otherwise replace the refused change on screen without a word. It stays until the next change.
 * `save` also rejects with the refusal, for a caller that shows it against the field.
 */
export function useSaveForm(id: string) {
  const client = useQueryClient();
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const mutationKey = [...keys.form(id), "save"];
  // The settling save itself still counts as in flight while its callbacks run; saves waiting
  // their turn count too.
  const isLastInFlight = () => client.isMutating({ mutationKey }) === 1;
  const { mutateAsync } = useMutation({
    mutationKey,
    scope: { id: mutationKey.join(":") },
    mutationFn: (changes: FormChanges) => api<Form>("PATCH", `/assessments/${id}/form`, changes),
    onMutate: async (changes) => {
      await client.cancelQueries({ queryKey: keys.form(id) });
      client.setQueryData<Form>(keys.form(id), (form) =>
        form && {
          ...form,
          answers: form.answers.map((a) =>
            changes.answers && a.qid in changes.answers ? { ...a, value: changes.answers[a.qid] } : a
          ),
        }
      );
    },
    onSuccess: (form) => {
      if (isLastInFlight()) client.setQueryData(keys.form(id), form);
      client.invalidateQueries({ queryKey: keys.assessments });
    },
    onError: (error, changes) => {
      setRefusal({ error, changes });
      // A later save still to finish brings the server's copy, without the refused change.
      if (isLastInFlight()) client.invalidateQueries({ queryKey: keys.form(id) });
    },
  });
  const save = useCallback(
    (changes: FormChanges): Promise<Form> => {
      setRefusal(null);
      return mutateAsync(changes);
    },
    [mutateAsync]
  );
  return { save, refusal };
}

/**
 * Whether anything done on the form (an answer, an upload, a removal) is still being sent. While
 * it is, closing or reloading the tab asks the browser to confirm, so it is not lost.
 */
export function useFormBusy(id: string): boolean {
  const busy = useIsMutating({ mutationKey: keys.form(id) }) > 0;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  return busy;
}

/** Starts a form over (before submission). Takes the assessment id when called. */
export function useResetForm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Form>("POST", `/assessments/${id}/form/reset`),
    onSuccess: (form, id) => {
      client.setQueryData(keys.form(id), form);
      client.invalidateQueries({ queryKey: keys.assessments });
    },
  });
}

export interface Upload {
  qid: string;
  optionCode: string;
  role: EvidenceRole;
  description?: string;
  /** A new file, which also goes into "Your documents"; or one already there. */
  file?: File;
  documentId?: string;
}

export function useUploadEvidence(id: string) {
  const client = useQueryClient();
  return useMutation({
    // Under the form's key, so the page can tell work on the form is still being sent.
    mutationKey: [...keys.form(id), "upload"],
    mutationFn: ({ file, ...fields }: Upload) => {
      const body = new FormData();
      if (file) body.append("file", file);
      for (const [name, value] of Object.entries(fields)) if (value) body.append(name, value);
      return api<EvidenceItem>("POST", `/assessments/${id}/evidence`, body);
    },
    onSuccess: () => refreshCaseData(client, id),
  });
}

/** Uploads one file to "Your documents", reporting its progress (0 to 1) as it is sent. */
export function useUploadDocument(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...keys.form(id), "document"],
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (share: number) => void }) =>
      uploadWithProgress<LibraryDocument>(`/assessments/${id}/documents`, file, onProgress),
    onSuccess: (document) => {
      // In the list at once, before the upload leaves the queue, so the room left is counted right.
      client.setQueryData<Form>(keys.form(id), (form) =>
        form && !(form.documents ?? []).some((d) => d.id === document.id)
          ? { ...form, documents: [...(form.documents ?? []), document] }
          : form
      );
    },
    // Read again once the whole batch is done (useRefreshCase, from the page that queues them):
    // the page sends a few at a time, so no single upload knows it is the last.
  });
}

/** Reads the form and the case again, as they stand on the server. */
export function useRefreshCase(id: string) {
  const client = useQueryClient();
  return useCallback(() => refreshCaseData(client, id), [client, id]);
}

/** Removes a document from "Your documents", and from every question it is attached to. */
export function useRemoveDocument(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...keys.form(id), "remove-document"],
    mutationFn: (documentId: string) => api<void>("DELETE", `/assessments/${id}/documents/${documentId}`),
    onSettled: () => refreshCaseData(client, id),
  });
}

export function useRemoveEvidence(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...keys.form(id), "remove"],
    mutationFn: (evidenceId: string) => api<void>("DELETE", `/assessments/${id}/evidence/${evidenceId}`),
    // Refused (the case moved on in another tab) or failed: the list is reloaded either way, so
    // it shows what is really attached.
    onSettled: () => refreshCaseData(client, id),
  });
}

function refreshCaseData(client: QueryClient, id: string) {
  client.invalidateQueries({ queryKey: keys.form(id) });
  client.invalidateQueries({ queryKey: keys.case(id) });
}

// ---- The case ---------------------------------------------------------------------------------

/** The case, checked again every few seconds while the engine is still working on it. */
export function useCase(id: string) {
  return useQuery({
    queryKey: keys.case(id),
    queryFn: () => api<Case>("GET", `/assessments/${id}/case`),
    refetchInterval: (query) => (query.state.data && RUNNING.includes(query.state.data.stage) ? POLL_MS : false),
  });
}

/** What to confirm once a step succeeded: a message, and its tone if not "good". */
type Confirm<T> = (updated: Case, input: T) => string | [string, ToastTone];

/**
 * Every workflow step answers with the updated case, which also changes the assessment's stage.
 * A refused step usually means the case moved on (the other party acted), so it is refreshed then
 * too, and the page shows where it now stands.
 *
 * After a step that succeeded, the stage it reports is written straight into the assessment, so
 * the page needs no request to show it; the assessment and the form are marked out of date and
 * read again when a page next needs them. Only the steps that change the form (submitting) read
 * it again at once (`changesForm`).
 */
function useCaseStep<T>(
  id: string,
  step: (input: T) => Promise<Case>,
  confirm?: Confirm<T>,
  { changesForm = false }: { changesForm?: boolean } = {}
) {
  const client = useQueryClient();
  const refreshRelated = () => {
    client.invalidateQueries({ queryKey: keys.assessment(id) });
    client.invalidateQueries({ queryKey: keys.assessments });
    client.invalidateQueries({ queryKey: keys.form(id) });
  };
  return useMutation({
    mutationFn: step,
    onSuccess: (updated, input) => {
      client.setQueryData(keys.case(id), updated);
      client.setQueryData<Assessment>(keys.assessment(id), (previous) =>
        previous ? { ...previous, stage: updated.stage } : previous
      );
      client.invalidateQueries({ queryKey: keys.assessment(id), refetchType: "none" });
      client.invalidateQueries({ queryKey: keys.assessments });
      client.invalidateQueries({ queryKey: keys.form(id), refetchType: changesForm ? "active" : "none" });
      const said = confirm?.(updated, input);
      if (said) {
        if (typeof said === "string") toast(said);
        else toast(said[0], said[1]);
      }
    },
    onError: () => {
      client.invalidateQueries({ queryKey: keys.case(id) });
      refreshRelated();
    },
  });
}

export const useSubmit = (id: string) =>
  useCaseStep(
    id,
    () => api<Case>("POST", `/assessments/${id}/submit`),
    () => "Application submitted. The AI engine is checking your evidence.",
    { changesForm: true }
  );
export const useResubmit = (id: string) =>
  useCaseStep(
    id,
    () => api<Case>("POST", `/assessments/${id}/resubmit`),
    () => "Resubmitted with your new evidence.",
    { changesForm: true }
  );
/** An admin takes the case to review it; the super user can take it over (takeOver). */
export const useClaim = (id: string) =>
  useCaseStep(
    id,
    ({ takeOver = false }: { takeOver?: boolean }) => api<Case>("POST", `/assessments/${id}/claim`, { takeOver }),
    () => "You are reviewing this case."
  );

/** The admin reviewing the case (or the super user) gives it back to the queue. */
export const useRelease = (id: string) =>
  useCaseStep(id, () => api<Case>("DELETE", `/assessments/${id}/claim`), () => "Released. Any admin of its department can take it.");

/** The super user gives the case to one of its department's admins. */
export const useAssign = (id: string) =>
  useCaseStep(
    id,
    ({ userId }: { userId: number; email: string }) => api<Case>("POST", `/assessments/${id}/assign`, { userId }),
    (_, { email }) => `Given to ${email}.`
  );

/** Who the super user can give the case to: its department's admins and the super users. */
export function useAssignees(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.case(id), "assignees"],
    queryFn: () => api<{ id: number; email: string; superUser: boolean }[]>("GET", `/assessments/${id}/assign`),
    enabled,
  });
}

export const useRetry = (id: string) =>
  useCaseStep(id, () => api<Case>("POST", `/assessments/${id}/retry`), () => "Sent to the AI engine again.");

export const useRule = (id: string) =>
  useCaseStep(
    id,
    ({ qid, verdict, comment }: { qid: string; verdict: Verdict; comment: string }) =>
      api<Case>("PUT", `/assessments/${id}/rulings/${qid}`, { verdict, comment }),
    (_, { qid, verdict }) => `${qid} ${verdict === "accepted" ? "accepted" : "rejected"}: ruling saved.`
  );

export const useUndoRuling = (id: string) =>
  useCaseStep(
    id,
    (qid: string) => api<Case>("DELETE", `/assessments/${id}/rulings/${qid}`),
    (_, qid) => [`Ruling on ${qid} undone.`, "info"]
  );

/** Reviewer: sends the case on once every flagged answer has a ruling. */
export const useCompleteReview = (id: string) =>
  useCaseStep(id, () => api<Case>("POST", `/assessments/${id}/complete-review`), (updated) =>
    updated.stage === "AWAITING_APPLICANT"
      ? "Returned to the applicant with your comments."
      : updated.stage === "SCORING"
        ? "Sent to the AI engine for scoring."
        : updated.run?.forceScoreError
          ? ["Sent on for your decision, but the AI engine could not score it; the reason is on the page.", "critical"]
          : "Sent on for your decision."
  );

/** Reviewer: asks the AI engine to score a case whose flagged answers were all accepted. */
export const useForceScore = (id: string) =>
  useCaseStep(id, () => api<Case>("POST", `/assessments/${id}/force-score`), (updated) =>
    updated.stage === "SCORING"
      ? "Sent to the AI engine for scoring."
      : ["The AI engine did not take it; the reason is on the page.", "critical"]
  );

export const useDecide = (id: string) =>
  useCaseStep(
    id,
    ({ verdict, remarks }: { verdict: Verdict; remarks: string }) =>
      api<Case>("POST", `/assessments/${id}/decision`, { verdict, remarks }),
    (_, { verdict }) =>
      `Assessment ${verdict === "accepted" ? "accepted" : "rejected"}. The applicant can see your feedback.`
  );

// ---- The reviewer's admin panel ----------------------------------------------------------------

export function useAdminOverview() {
  return useQuery({
    queryKey: [...keys.admin, "overview"],
    queryFn: () => api<AdminOverview>("GET", "/admin/overview"),
  });
}

export interface AdminUserFilters {
  search: string;
  /** "reviewer" is admins and super users together; "admin" is admins only. */
  role: "" | "applicant" | "reviewer" | "admin" | "superuser";
  status: "" | "active" | "inactive";
}

/** Every account, newest first, a page at a time. */
export function useAdminUsers(filters: AdminUserFilters) {
  return useInfiniteQuery({
    queryKey: [...keys.admin, "users", filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.role) params.set("role", filters.role);
      if (filters.status) params.set("status", filters.status);
      if (pageParam) params.set("page", pageParam);
      const query = params.toString();
      return api<Page<AdminUserRow>>("GET", `/admin/users${query ? `?${query}` : ""}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
    // Typing in the search keeps the current list on screen until the new one arrives.
    placeholderData: (previous) => previous,
  });
}

export function useAdminUser(userId: number) {
  return useQuery({
    queryKey: [...keys.admin, "user", userId],
    queryFn: () => api<AdminUserDetail>("GET", `/admin/users/${userId}`),
    enabled: Number.isInteger(userId) && userId > 0,
  });
}

export interface AccessChange {
  role?: AccountRole;
  departments?: string[];
  isActive?: boolean;
}

/** The super user changes an account's role, an admin's departments, or whether it may sign in. */
export function useUpdateAccess(userId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: AccessChange) => api<AdminUserDetail>("PATCH", `/admin/users/${userId}`, change),
    onSuccess: (user) => {
      client.setQueryData([...keys.admin, "user", userId], user);
      // The lists and counts show roles too.
      client.invalidateQueries({ queryKey: keys.admin, predicate: (q) => q.queryKey[1] !== "user" });
      const released = user.released
        ? ` ${user.released} case${user.released === 1 ? "" : "s"} they were reviewing went back to the queue.`
        : "";
      toast(
        `Access saved. The person is signed out if their role or departments changed, and sees the change when they sign in again.${released}`,
        "good"
      );
    },
  });
}

export function useAdminDepartments() {
  return useQuery({
    queryKey: [...keys.admin, "departments"],
    queryFn: () => api<AdminDepartment[]>("GET", "/admin/departments"),
  });
}

export interface NewDepartment {
  key: string;
  name: string;
  blurb: string;
  /** The department whose questions it starts with a copy of; null: no questions (set up afterwards). */
  startFrom: string | null;
}

/** The super user adds a department, or renames one or switches it off or on. */
export function useDepartmentChanges() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: keys.admin });
    client.invalidateQueries({ queryKey: keys.departments });
    // The session lists the super user's departments.
    client.invalidateQueries({ queryKey: keys.session });
  };
  const create = useMutation({
    mutationFn: (input: NewDepartment) => api<AdminDepartment>("POST", "/admin/departments", input),
    onSuccess: (d, input) => {
      refresh();
      toast(
        input.startFrom
          ? `${d.name} added, with its own copy of the questions.`
          : `${d.name} added. It takes applications once its questions are set up.`,
        "good"
      );
    },
  });
  const update = useMutation({
    mutationFn: ({ key, ...change }: { key: string; name?: string; blurb?: string; isActive?: boolean }) =>
      api<AdminDepartment>("PATCH", `/admin/departments/${encodeURIComponent(key)}`, change),
    onSuccess: (changed) => {
      // The list shows the change at once; the rest is read again behind it.
      client.setQueryData<AdminDepartment[]>([...keys.admin, "departments"], (list) =>
        list?.map((d) => (d.key === changed.key ? changed : d))
      );
      refresh();
    },
  });
  return { create, update };
}

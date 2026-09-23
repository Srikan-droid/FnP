import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getDraft, saveDraft, resetDraft } from "./draftStore";
import { isEvidenceRequired } from "../domain/evidenceRules";
import type { Assignment } from "../data/assignments";
import type { Answer, ApplicationForm, EvidenceRef } from "../domain/types";

const SESSION_KEY = "fnp-session-email";

interface AssessmentContextValue {
  email: string | null;
  signIn: (email: string) => void;
  signOut: () => void;
  getForm: (assignment: Assignment) => ApplicationForm;
  updateAnswer: (assignment: Assignment, qid: string, answer: Answer) => void;
  attachEvidence: (assignment: Assignment, qid: string, evidence: EvidenceRef) => void;
  removeEvidence: (assignment: Assignment, qid: string, docType: string) => void;
  startNewApplication: (assignment: Assignment) => void;
}

const AssessmentContext = createContext<AssessmentContextValue | null>(null);

function readStoredEmail(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function AssessmentProvider({ children }: { children: ReactNode }) {
  const [forms, setForms] = useState<Record<string, ApplicationForm>>({});
  const [email, setEmail] = useState<string | null>(readStoredEmail);

  const signIn = useCallback((value: string) => {
    const normalized = value.trim().toLowerCase();
    sessionStorage.setItem(SESSION_KEY, normalized);
    setEmail(normalized);
  }, []);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setEmail(null);
  }, []);

  const getForm = useCallback(
    (assignment: Assignment) => forms[assignment.id] ?? getDraft(assignment),
    [forms]
  );

  const persist = useCallback((assignmentId: string, next: ApplicationForm) => {
    setForms((prev) => ({ ...prev, [assignmentId]: next }));
    saveDraft(assignmentId, next);
  }, []);

  const updateAnswer = useCallback(
    (assignment: Assignment, qid: string, answer: Answer) => {
      const base = forms[assignment.id] ?? getDraft(assignment);
      const next: ApplicationForm = {
        ...base,
        responses: base.responses.map((r) => {
          if (r.qid !== qid) return r;
          const required = isEvidenceRequired(qid, answer);
          return {
            ...r,
            answer,
            evidence_required: required,
            // Evidence only exists to support a question that currently requires it — drop it
            // the moment an answer change makes it inapplicable, so stale attachments never
            // linger against a question that no longer needs proof.
            evidence: required ? r.evidence : [],
          };
        }),
      };
      persist(assignment.id, next);
    },
    [forms, persist]
  );

  const attachEvidence = useCallback(
    (assignment: Assignment, qid: string, evidence: EvidenceRef) => {
      const base = forms[assignment.id] ?? getDraft(assignment);
      const next: ApplicationForm = {
        ...base,
        responses: base.responses.map((r) =>
          r.qid === qid
            ? {
                ...r,
                evidence: [...r.evidence.filter((e) => e.doc_type !== evidence.doc_type), evidence],
              }
            : r
        ),
      };
      persist(assignment.id, next);
    },
    [forms, persist]
  );

  const removeEvidence = useCallback(
    (assignment: Assignment, qid: string, docType: string) => {
      const base = forms[assignment.id] ?? getDraft(assignment);
      const next: ApplicationForm = {
        ...base,
        responses: base.responses.map((r) =>
          r.qid === qid ? { ...r, evidence: r.evidence.filter((e) => e.doc_type !== docType) } : r
        ),
      };
      persist(assignment.id, next);
    },
    [forms, persist]
  );

  const startNewApplication = useCallback((assignment: Assignment) => {
    const fresh = resetDraft(assignment);
    setForms((prev) => ({ ...prev, [assignment.id]: fresh }));
  }, []);

  const value = useMemo(
    () => ({
      email,
      signIn,
      signOut,
      getForm,
      updateAnswer,
      attachEvidence,
      removeEvidence,
      startNewApplication,
    }),
    [
      email,
      signIn,
      signOut,
      getForm,
      updateAnswer,
      attachEvidence,
      removeEvidence,
      startNewApplication,
    ]
  );

  return <AssessmentContext.Provider value={value}>{children}</AssessmentContext.Provider>;
}

export function useAssessment() {
  const ctx = useContext(AssessmentContext);
  if (!ctx) throw new Error("useAssessment must be used within AssessmentProvider");
  return ctx;
}

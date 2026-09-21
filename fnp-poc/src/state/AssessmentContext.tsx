import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getDraft, saveDraft, resetDraft as resetDraftInStore } from "./draftStore";
import type { NewApplicationDetails } from "./draftStore";
import { isEvidenceRequired } from "../domain/evidenceRules";
import type { Answer, ApplicationForm, EvidenceRef } from "../domain/types";

interface AssessmentContextValue {
  getForm: (applicationId: string) => ApplicationForm;
  updateAnswer: (applicationId: string, qid: string, answer: Answer) => void;
  attachEvidence: (applicationId: string, qid: string, evidence: EvidenceRef) => void;
  startNewApplication: (applicationId: string, details: NewApplicationDetails) => void;
}

const AssessmentContext = createContext<AssessmentContextValue | null>(null);

export function AssessmentProvider({ children }: { children: ReactNode }) {
  const [forms, setForms] = useState<Record<string, ApplicationForm>>({});

  const getForm = useCallback(
    (applicationId: string) => {
      return forms[applicationId] ?? getDraft(applicationId);
    },
    [forms]
  );

  const persist = useCallback((applicationId: string, next: ApplicationForm) => {
    setForms((prev) => ({ ...prev, [applicationId]: next }));
    saveDraft(applicationId, next);
  }, []);

  const updateAnswer = useCallback(
    (applicationId: string, qid: string, answer: Answer) => {
      const base = forms[applicationId] ?? getDraft(applicationId);
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
      persist(applicationId, next);
    },
    [forms, persist]
  );

  const attachEvidence = useCallback(
    (applicationId: string, qid: string, evidence: EvidenceRef) => {
      const base = forms[applicationId] ?? getDraft(applicationId);
      const next: ApplicationForm = {
        ...base,
        responses: base.responses.map((r) =>
          r.qid === qid ? { ...r, evidence: [...r.evidence.filter((e) => e.doc_type !== evidence.doc_type), evidence] } : r
        ),
      };
      persist(applicationId, next);
    },
    [forms, persist]
  );

  const startNewApplication = useCallback(
    (applicationId: string, details: NewApplicationDetails) => {
      const fresh = resetDraftInStore(applicationId, details);
      setForms((prev) => ({ ...prev, [applicationId]: fresh }));
    },
    []
  );

  const value = useMemo(
    () => ({ getForm, updateAnswer, attachEvidence, startNewApplication }),
    [getForm, updateAnswer, attachEvidence, startNewApplication]
  );

  return <AssessmentContext.Provider value={value}>{children}</AssessmentContext.Provider>;
}

export function useAssessment() {
  const ctx = useContext(AssessmentContext);
  if (!ctx) throw new Error("useAssessment must be used within AssessmentProvider");
  return ctx;
}

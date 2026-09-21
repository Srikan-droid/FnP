import { APPLICATION_FORMS } from "../data/fixtures";
import { QUESTIONS } from "../domain/questions";
import { isEvidenceRequired } from "../domain/evidenceRules";
import type { ApplicationForm } from "../domain/types";

const storageKey = (applicationId: string) => `fnp-draft-${applicationId}`;

export interface NewApplicationDetails {
  entityName: string;
  positionAppliedFor: string;
}

function blankForm(applicationId: string, details?: NewApplicationDetails): ApplicationForm {
  const identity = APPLICATION_FORMS[applicationId];
  return {
    application_id: applicationId,
    licensee: details?.entityName ?? identity?.licensee ?? "",
    applicant: {
      full_name: identity?.applicant.full_name ?? applicationId,
      proposed_role: details?.positionAppliedFor ?? identity?.applicant.proposed_role ?? "",
      date_of_birth: identity?.applicant.date_of_birth ?? "",
      town: identity?.applicant.town ?? "",
    },
    submitted_at: new Date().toISOString(),
    responses: QUESTIONS.map((q) => ({
      qid: q.qid,
      section: q.section,
      question: q.question,
      answer: "No" as const,
      declared_values: {},
      evidence_required: isEvidenceRequired(q.qid, "No"),
      evidence: [],
    })),
  };
}

/** The seeded "old draft" — the first time a user's draft is read, it's the full test fixture. */
export function getDraft(applicationId: string): ApplicationForm {
  const raw = localStorage.getItem(storageKey(applicationId));
  if (raw) {
    try {
      return JSON.parse(raw) as ApplicationForm;
    } catch {
      // fall through to reseed below
    }
  }
  const seeded = APPLICATION_FORMS[applicationId]
    ? (JSON.parse(JSON.stringify(APPLICATION_FORMS[applicationId])) as ApplicationForm)
    : blankForm(applicationId);
  saveDraft(applicationId, seeded);
  return seeded;
}

export function saveDraft(applicationId: string, form: ApplicationForm): void {
  localStorage.setItem(storageKey(applicationId), JSON.stringify(form));
}

/** Overwrites whatever draft exists (seeded or user-edited) with a blank one. */
export function resetDraft(applicationId: string, details: NewApplicationDetails): ApplicationForm {
  const fresh = blankForm(applicationId, details);
  saveDraft(applicationId, fresh);
  return fresh;
}

export function hasSavedDraft(applicationId: string): boolean {
  return localStorage.getItem(storageKey(applicationId)) !== null;
}

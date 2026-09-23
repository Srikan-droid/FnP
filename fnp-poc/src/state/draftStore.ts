import { APPLICATION_FORMS } from "../data/fixtures";
import { QUESTIONS } from "../domain/questions";
import { isEvidenceRequired } from "../domain/evidenceRules";
import type { Assignment } from "../data/assignments";
import type { ApplicationForm } from "../domain/types";

const storageKey = (assignmentId: string) => `fnp-draft-${assignmentId}`;

/** Entity and position always come from the parent application, never from the draft. */
function withParentDetails(form: ApplicationForm, assignment: Assignment): ApplicationForm {
  return {
    ...form,
    application_id: assignment.id,
    licensee: assignment.entity,
    applicant: { ...form.applicant, proposed_role: assignment.position },
  };
}

function blankForm(assignment: Assignment): ApplicationForm {
  const source = APPLICATION_FORMS[assignment.applicantId];
  return {
    application_id: assignment.id,
    licensee: assignment.entity,
    applicant: {
      full_name: assignment.applicantName,
      proposed_role: assignment.position,
      date_of_birth: source?.applicant.date_of_birth ?? "",
      town: source?.applicant.town ?? "",
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

function seededForm(assignment: Assignment): ApplicationForm {
  const source = APPLICATION_FORMS[assignment.applicantId];
  if (!source) return blankForm(assignment);
  const clone = JSON.parse(JSON.stringify(source)) as ApplicationForm;
  return withParentDetails(clone, assignment);
}

/**
 * A draft exists only once the filer has started one. Assessments flagged `seededDraft`
 * simulate a department where the filer already began, so both states are demonstrable.
 */
export function hasDraft(assignment: Assignment): boolean {
  return localStorage.getItem(storageKey(assignment.id)) !== null || assignment.seededDraft;
}

export function getDraft(assignment: Assignment): ApplicationForm {
  const raw = localStorage.getItem(storageKey(assignment.id));
  if (raw) {
    try {
      return withParentDetails(JSON.parse(raw) as ApplicationForm, assignment);
    } catch {
      // fall through and rebuild below
    }
  }
  if (assignment.seededDraft) {
    const seeded = seededForm(assignment);
    saveDraft(assignment.id, seeded);
    return seeded;
  }
  return blankForm(assignment);
}

export function saveDraft(assignmentId: string, form: ApplicationForm): void {
  localStorage.setItem(storageKey(assignmentId), JSON.stringify(form));
}

/** Overwrites whatever draft exists with a blank one. */
export function resetDraft(assignment: Assignment): ApplicationForm {
  const fresh = blankForm(assignment);
  saveDraft(assignment.id, fresh);
  return fresh;
}

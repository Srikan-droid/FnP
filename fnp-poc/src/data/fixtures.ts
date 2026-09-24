import app001 from "./testset/form_data/APP001.json";
import app002 from "./testset/form_data/APP002.json";
import app003 from "./testset/form_data/APP003.json";
import app004 from "./testset/form_data/APP004.json";
import app005 from "./testset/form_data/APP005.json";
import { QUESTION_BY_QID } from "../domain/questions";
import type { ApplicationForm, ResponseItem } from "../domain/types";

/** Shape of the v5 test set files: sections, each holding its questions. */
interface V5File {
  application_id: string;
  licensee: string;
  applicant: ApplicationForm["applicant"];
  submitted_at: string;
  sections: {
    section: string;
    section_weight: number;
    questions: Omit<ResponseItem, "section">[];
  }[];
}

/**
 * The app works with one flat question list; the section stays on each question.
 *
 * Question wording comes from the QUESTIONS table rather than the payload: the v5 workbook
 * reworded PC1, FC7 and CoI6, but the generated JSON still carries the older text. Reading it
 * from one place keeps a seeded draft and a blank form showing the same question.
 */
function flatten(file: V5File): ApplicationForm {
  return {
    application_id: file.application_id,
    licensee: file.licensee,
    applicant: file.applicant,
    submitted_at: file.submitted_at,
    responses: file.sections.flatMap((section) =>
      section.questions.map((q) => ({
        ...q,
        section: section.section,
        question: QUESTION_BY_QID[q.qid]?.question ?? q.question,
      }))
    ),
  };
}

export const APPLICATION_FORMS: Record<string, ApplicationForm> = {
  APP001: flatten(app001 as unknown as V5File),
  APP002: flatten(app002 as unknown as V5File),
  APP003: flatten(app003 as unknown as V5File),
  APP004: flatten(app004 as unknown as V5File),
  APP005: flatten(app005 as unknown as V5File),
};

/**
 * The documents that actually exist under public/evidence. The test pack ships one document per
 * question, matching that question's primary dropdown option, so picking any other option has
 * nothing to open.
 */
const SHARED_DOCS = [
  "board_appointment_letter",
  "company_registry_extract",
  "degree_certificate",
  "employment_letter",
  "national_id",
  "police_clearance",
  "suitability_declaration",
  "tax_compliance_certificate",
];

const EVIDENCE_FILES: Record<string, Set<string>> = {
  APP001: new Set(SHARED_DOCS),
  APP002: new Set(SHARED_DOCS),
  APP003: new Set([...SHARED_DOCS, "naturalisation_certificate"]),
  APP004: new Set([...SHARED_DOCS, "bank_reference_letter", "share_certificate"]),
  APP005: new Set([...SHARED_DOCS, "share_register_extract"]),
};

export function hasEvidenceFile(applicantId: string, docType: string): boolean {
  return EVIDENCE_FILES[applicantId]?.has(docType) ?? false;
}

export function evidenceUrl(applicantId: string, fileName: string): string {
  return `/evidence/${applicantId}/${fileName}`;
}

import app001 from "./testset/form_data/APP001.json";
import app002 from "./testset/form_data/APP002.json";
import app003 from "./testset/form_data/APP003.json";
import app004 from "./testset/form_data/APP004.json";
import app005 from "./testset/form_data/APP005.json";
import type { ApplicationForm, ResponseItem } from "../domain/types";

/** Shape of the v2 test set files: sections, each holding its questions. */
interface V2File {
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

/** The app works with one flat question list; the section stays on each question. */
function flatten(file: V2File): ApplicationForm {
  return {
    application_id: file.application_id,
    licensee: file.licensee,
    applicant: file.applicant,
    submitted_at: file.submitted_at,
    responses: file.sections.flatMap((section) =>
      section.questions.map((q) => ({ ...q, section: section.section }))
    ),
  };
}

export const APPLICATION_FORMS: Record<string, ApplicationForm> = {
  APP001: flatten(app001 as unknown as V2File),
  APP002: flatten(app002 as unknown as V2File),
  APP003: flatten(app003 as unknown as V2File),
  APP004: flatten(app004 as unknown as V2File),
  APP005: flatten(app005 as unknown as V2File),
};

export function evidenceUrl(applicantId: string, fileName: string): string {
  return `/evidence/${applicantId}/${fileName}`;
}

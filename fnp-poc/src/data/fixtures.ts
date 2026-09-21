import app001 from "./testset/form_data/APP001.json";
import app002 from "./testset/form_data/APP002.json";
import app003 from "./testset/form_data/APP003.json";
import app004 from "./testset/form_data/APP004.json";
import app005 from "./testset/form_data/APP005.json";
import expectedResultsRaw from "./testset/expected_results.json";
import type { ApplicationForm, FieldExpectation } from "../domain/types";

export const APPLICATION_FORMS: Record<string, ApplicationForm> = {
  APP001: app001 as unknown as ApplicationForm,
  APP002: app002 as unknown as ApplicationForm,
  APP003: app003 as unknown as ApplicationForm,
  APP004: app004 as unknown as ApplicationForm,
  APP005: app005 as unknown as ApplicationForm,
};

export const APPLICANT_PROFILES: { id: string; name: string; blurb: string }[] = [
  { id: "APP001", name: "Johanna N. Amutenya", blurb: "Clean baseline — everything matches." },
  { id: "APP002", name: "Petrus K. Shivute", blurb: "Two transcription-level mismatches (DOB, degree year)." },
  { id: "APP003", name: "Elias T. Haufiku", blurb: "Overstated experience + a missing tax certificate." },
  { id: "APP004", name: "Maria L. van Wyk", blurb: "Declares no record, but clearance shows a conviction." },
  { id: "APP005", name: "Margaret Kaapanda", blurb: "Maiden name / legal-suffix tolerance cases." },
];

interface ExpectedResultsFile {
  applications: Record<string, { applicant: string; profile: string; fields: FieldExpectation[] }>;
}

const expectedResults = expectedResultsRaw as ExpectedResultsFile;

export function getExpectedFields(applicationId: string): FieldExpectation[] {
  return expectedResults.applications[applicationId]?.fields ?? [];
}

export function evidenceUrl(applicationId: string, fileName: string): string {
  return `/evidence/${applicationId}/${fileName}`;
}

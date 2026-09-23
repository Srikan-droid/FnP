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

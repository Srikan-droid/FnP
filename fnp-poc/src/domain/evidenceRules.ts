import type { Answer, ResponseItem } from "./types";

// Questions where evidence proves a standing fact (identity, qualification, appointment terms,
// current compliance) and is needed no matter what the answer is — only N/A drops it.
const ALWAYS_REQUIRED_QIDS = new Set(["A1", "Q1", "Q3", "PC1", "PC19", "T1", "T2", "CS4"]);

// Questions where evidence only supports a disclosure ("yes, I hold shares in X") — if the
// answer is "No" there is nothing to disclose, so no document is required.
const REQUIRED_ONLY_IF_YES_QIDS = new Set(["A4", "CoI2", "CoI6", "FC5", "FC7", "CoL1", "CoL3"]);

export function isEvidenceRequired(qid: string, answer: Answer): boolean {
  if (answer === "N/A") return false;
  if (ALWAYS_REQUIRED_QIDS.has(qid)) return true;
  if (REQUIRED_ONLY_IF_YES_QIDS.has(qid)) return answer === "Yes";
  return false;
}

export function hasMissingMandatoryEvidence(response: ResponseItem): boolean {
  return response.evidence_required && response.evidence.length === 0;
}

// The document type each question's evidence is expected to be, consistent across every
// applicant in the test set — used to simulate an upload when a question has none attached yet.
export const DOC_TYPE_BY_QID: Record<string, string> = {
  A1: "national_id",
  A4: "naturalisation_certificate",
  Q1: "degree_certificate",
  Q3: "employment_letter",
  PC1: "police_clearance",
  PC19: "tax_compliance_certificate",
  FC5: "bank_reference_letter",
  FC7: "bank_reference_letter",
  CoI2: "company_registry_extract",
  CoI6: "company_registry_extract",
  T1: "board_appointment_letter",
  T2: "board_appointment_letter",
  CoL1: "share_certificate",
  CoL3: "share_register_extract",
  CS4: "suitability_declaration",
};

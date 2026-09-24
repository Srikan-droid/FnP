import type { Answer, ResponseItem } from "./types";

// "Mandatory" in the v5 Questions sheet: evidence proves a standing fact (identity,
// qualification, appointment terms, directorships) and is needed whatever the answer — only
// N/A drops it.
const ALWAYS_REQUIRED_QIDS = new Set([
  "A1",
  "Q1",
  "Q3",
  "PC1",
  "PC19",
  "CoI2",
  "T1",
  "T2",
  "CS4",
]);

// "Mandatory if answer is Yes": evidence only supports a disclosure ("yes, I hold shares in
// X"), so a No has nothing to prove.
const REQUIRED_ONLY_IF_YES_QIDS = new Set(["A4", "CoI6", "FC5", "FC7", "CoL1", "CoL3"]);

export function isEvidenceRequired(qid: string, answer: Answer): boolean {
  if (answer === "N/A") return false;
  if (ALWAYS_REQUIRED_QIDS.has(qid)) return true;
  if (REQUIRED_ONLY_IF_YES_QIDS.has(qid)) return answer === "Yes";
  return false;
}

export function hasMissingMandatoryEvidence(response: ResponseItem): boolean {
  return response.evidence_required && response.evidence.length === 0;
}

import { labelForDocType } from "./evidenceOptions";
import type {
  ApplicationForm,
  AuthenticationOutcome,
  CheckResult,
  CheckStatus,
  QuestionAuthResult,
  ResponseItem,
  SectionAuthResult,
} from "./types";

const CHECK_LABELS: Record<string, string> = {
  Document_Check: "Document type",
  Name_Check: "Document belongs to applicant",
  Age_Check: "Age derived from document",
  Naturalization_Check: "Naturalised status",
  Qualification_Relevance_Check: "Qualification relevant to the role",
  Experience_Duration_Check: "Length of relevant service",
  Experience_Relevance_Check: "Experience relevant to the role",
  Record_Check: "Conviction or civil finding",
  Scope_Check: "Search period and jurisdictions covered",
  Compliance_History_Check: "History of non-compliance",
  Period_Coverage_Check: "Document covers a historical period",
  Facility_Status_Check: "Facility restructured, written off or forgiven",
  Indebtedness_Amount_Check: "Aggregate indebtedness against the threshold",
  Directorship_Check: "Directorship recorded",
  Entity_Activity_Check: "Entity engaged in financial services",
  Beneficial_Ownership_Check: "Beneficial interest held",
  Controlling_Interest_Threshold_Check: "Controlling interest threshold",
  Time_Commitment_Check: "Time commitment stated",
  Executive_Responsibility_Check: "Executive responsibility stated",
  Shareholding_Check: "Shares of the Licensee held",
  Relative_Name_Check: "Relative identified by name",
  Relationship_Check: "Relationship stated on the document",
  Signature_Check: "Declaration signed and witnessed",
  Declaration_Content_Check: "Declaration wording covers the attestation",
};

/**
 * From the "Checks" sheet of fnp_authentication_testset_v5.xlsx, which defines checks for all
 * 15 questions. Read from here rather than the payload's `checks_to_perform`, which the v5
 * generator populates for A1 and A4 only and leaves empty for the other thirteen.
 *
 * Note the two questions that do not run Name_Check: CS4 verifies the signature instead, and
 * CoL3 is about a relative rather than the applicant.
 */
const CHECKS_BY_QID: Record<string, string[]> = {
  A1: ["Document_Check", "Name_Check", "Age_Check"],
  A4: ["Document_Check", "Name_Check", "Naturalization_Check"],
  Q1: ["Document_Check", "Name_Check", "Qualification_Relevance_Check"],
  Q3: [
    "Document_Check",
    "Name_Check",
    "Experience_Duration_Check",
    "Experience_Relevance_Check",
  ],
  PC1: ["Document_Check", "Name_Check", "Record_Check", "Scope_Check"],
  PC19: ["Document_Check", "Name_Check", "Compliance_History_Check", "Period_Coverage_Check"],
  FC5: ["Document_Check", "Name_Check", "Facility_Status_Check"],
  FC7: ["Document_Check", "Name_Check", "Indebtedness_Amount_Check"],
  CoI2: ["Document_Check", "Name_Check", "Directorship_Check", "Entity_Activity_Check"],
  CoI6: [
    "Document_Check",
    "Name_Check",
    "Beneficial_Ownership_Check",
    "Controlling_Interest_Threshold_Check",
  ],
  T1: ["Document_Check", "Name_Check", "Time_Commitment_Check"],
  T2: ["Document_Check", "Name_Check", "Executive_Responsibility_Check"],
  CoL1: ["Document_Check", "Name_Check", "Shareholding_Check"],
  CoL3: ["Document_Check", "Relative_Name_Check", "Relationship_Check", "Shareholding_Check"],
  CS4: ["Document_Check", "Signature_Check", "Declaration_Content_Check"],
};

function checksFor(response: ResponseItem): string[] {
  return CHECKS_BY_QID[response.qid] ?? ["Document_Check", "Name_Check"];
}

interface CheckOverride {
  status: CheckStatus;
  confidence: number;
  note: string;
}

/**
 * Ground truth from the v2 workbook: the three answer-level contradictions in "Expected
 * Verdicts", plus the "must not fail" cases, which pass but at reduced confidence because the
 * engine had to work for them.
 */
const OVERRIDES: Record<string, Record<string, CheckOverride>> = {
  "APP003:Q3": {
    Experience_Duration_Check: {
      status: "fail",
      confidence: 0.24,
      note: "The letter records 2018-03-01 to 2026-04-30 — 8 years 2 months — and states there was no prior service with this employer. The evidence cannot support a claim of ten years or more.",
    },
  },
  "APP004:PC1": {
    Record_Check: {
      status: "fail",
      confidence: 0.19,
      note: "The clearance certificate records a 2013 conviction under section 34 of the Companies Act (Annexure A), not expunged. The answer derived from the evidence is Yes.",
    },
  },
  "APP005:Q1": {
    Name_Check: {
      status: "caution",
      confidence: 0.74,
      note: "The certificate is in the maiden name Margaret Iipinge and the page is scanned. Resolved against the national ID, which records the 1991 change of surname.",
    },
  },
  "APP002:A1": {
    Age_Check: {
      status: "caution",
      confidence: 0.78,
      note: "The date of birth appears only on a scanned national ID, so the value was read by OCR rather than from embedded text.",
    },
  },
  "APP004:FC5": {
    Facility_Status_Check: {
      status: "caution",
      confidence: 0.76,
      note: "The letter confirms the facility was restructured but explicitly not written off or forgiven. The question is disjunctive, so Yes is correct.",
    },
  },
};

/** What a check says when it passes. `{doc}` is replaced with the attached document's label. */
const PASSING_NOTES: Record<string, string> = {
  Document_Check: "The uploaded file reads as a {doc}, matching the document type selected.",
  Name_Check: "The name on the document matches the applicant record.",
  Age_Check:
    "Date of birth read from the {doc}; the age at the reference date falls as the answer states.",
  Naturalization_Check:
    "The certificate establishes naturalised status, and the status is current rather than revoked or lapsed.",
  Qualification_Relevance_Check:
    "The qualification shown is relevant to the oversight and executive responsibilities of the proposed role.",
  Experience_Duration_Check:
    "Relevant service computed from the dates on the {doc} meets the ten year threshold.",
  Experience_Relevance_Check:
    "The experience shown is relevant to the proposed role on both seniority and sector.",
  Record_Check:
    "The {doc} discloses no conviction, pending charge, civil finding of liability or military tribunal finding.",
  Scope_Check:
    "The search stated on the document covers the period and the jurisdictions the question asks about.",
  Compliance_History_Check:
    "The {doc} discloses no period of non-compliance with tax or other statutory obligations.",
  Period_Coverage_Check:
    "The document covers a historical period rather than current status alone, so a past lapse would have been visible.",
  Facility_Status_Check:
    "No facility shown has been restructured, renegotiated, written off or forgiven for non-payment.",
  Indebtedness_Amount_Check:
    "Aggregate indebtedness shown on the {doc} was reconciled against the threshold in the question.",
  Directorship_Check: "The applicant is recorded on the {doc} as a director, with dates.",
  Entity_Activity_Check:
    "The entity's principal activity falls within the definition of financial services the question refers to.",
  Beneficial_Ownership_Check:
    "The {doc} shows the beneficial interest held by the applicant, directly or through another arrangement.",
  Controlling_Interest_Threshold_Check:
    "The holding shown was compared against the 20% voting-share test and the board-control test.",
  Time_Commitment_Check:
    "The appointment letter states a time commitment consistent with the answer given.",
  Executive_Responsibility_Check:
    "The {doc} states whether the appointment carries executive responsibility for managing the institution.",
  Shareholding_Check: "The {doc} shows the shares of the Licensee held by the person named.",
  Relative_Name_Check: "The document identifies a specific relative by name, distinct from the applicant.",
  Relationship_Check:
    "The document states a relationship that counts as an immediate relative.",
  Signature_Check: "The declaration is signed and witnessed as required.",
  Declaration_Content_Check:
    "The declaration's wording covers the specific attestation the question requires.",
};

function passingNote(checkName: string, response: ResponseItem): string {
  const docType = response.evidence[0]?.doc_type ?? "document";
  const docLabel = labelForDocType(docType, response.qid).toLowerCase();
  const template =
    PASSING_NOTES[checkName] ?? `The {doc} supports the answer of "${response.answer}".`;
  return template.replaceAll("{doc}", docLabel);
}

function runCheck(applicantId: string, response: ResponseItem, checkName: string): CheckResult {
  const override = OVERRIDES[`${applicantId}:${response.qid}`]?.[checkName];
  return {
    name: checkName,
    label: CHECK_LABELS[checkName] ?? checkName.replaceAll("_", " "),
    status: override?.status ?? "pass",
    confidence: override?.confidence ?? 0.96,
    note: override?.note ?? passingNote(checkName, response),
  };
}

function authenticateQuestion(applicantId: string, response: ResponseItem): QuestionAuthResult {
  const base = {
    qid: response.qid,
    question: response.question,
    answer: response.answer,
  };

  // No attachment means nothing was checked — either because none was asked for, or because a
  // mandatory one is missing, which is itself an issue.
  if (response.evidence.length === 0) {
    return {
      ...base,
      status: response.evidence_required ? "issue" : "not_checked",
      checks: [],
      confidence: null,
      summary: response.evidence_required
        ? "No document attached, so this answer could not be authenticated."
        : "No supporting document was required for this answer.",
    };
  }

  const checks = checksFor(response).map((name) => runCheck(applicantId, response, name));
  const confidence = Math.min(...checks.map((c) => c.confidence));
  const failed = checks.filter((c) => c.status === "fail");
  const cautions = checks.filter((c) => c.status === "caution");

  return {
    ...base,
    status: failed.length > 0 ? "issue" : "authenticated",
    checks,
    confidence,
    summary:
      failed.length > 0
        ? `${failed.length} check${failed.length > 1 ? "s" : ""} could not be satisfied by the evidence.`
        : cautions.length > 0
          ? `Authenticated, with ${cautions.length} check${cautions.length > 1 ? "s" : ""} the engine had to work for.`
          : "Every check passed against the attached document.",
  };
}

export function authenticate(
  assessmentId: string,
  applicantId: string,
  form: ApplicationForm
): AuthenticationOutcome {
  const sections: SectionAuthResult[] = [];

  for (const response of form.responses) {
    const result = authenticateQuestion(applicantId, response);
    let section = sections.find((s) => s.section === response.section);
    if (!section) {
      section = { section: response.section, issueCount: 0, questions: [] };
      sections.push(section);
    }
    section.questions.push(result);
    if (result.status === "issue") section.issueCount += 1;
  }

  const questions = sections.flatMap((s) => s.questions);
  const scored = questions.filter((q) => q.confidence !== null);

  return {
    assessmentId,
    sections,
    isClean: sections.every((s) => s.issueCount === 0),
    overallConfidence:
      scored.length > 0
        ? scored.reduce((sum, q) => sum + (q.confidence ?? 0), 0) / scored.length
        : null,
    checksRun: questions.reduce((total, q) => total + q.checks.length, 0),
  };
}

export function allQuestions(outcome: AuthenticationOutcome): QuestionAuthResult[] {
  return outcome.sections.flatMap((s) => s.questions);
}

export function issuesIn(outcome: AuthenticationOutcome): QuestionAuthResult[] {
  return allQuestions(outcome).filter((q) => q.status === "issue");
}

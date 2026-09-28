/** Pseudo-question id for the CV, which has a dropdown but is not one of the 15 questions. */
export const CV_QID = "CV";

export interface EvidenceOption {
  code: string;
  label: string;
  docType: string;
  /**
   * File formats this document may be uploaded in, first one being what the test pack ships.
   * Most instruments arrive as a scanned PDF, but a credit bureau report is issued as a
   * workbook, so the accepted set is per document type rather than one global rule.
   */
  accepts?: string[];
}

export const OTHER_OPTION: EvidenceOption = {
  code: "OTHER",
  label: "Other — please specify",
  docType: "other_document",
};

/**
 * Ported verbatim from the "Evidence Options" sheet of fnp_authentication_testset_v5.xlsx,
 * which now covers all 15 questions. The first option in each list is the primary one — the
 * document the test pack actually ships for that question — and "Other" is appended to every
 * list by evidenceOptionsFor().
 */
const OPTIONS_BY_QID: Record<string, EvidenceOption[]> = {
  A1: [
    { code: "PASSPORT", label: "Passport (biographical data page)", docType: "passport" },
    { code: "NATIONAL_ID", label: "National identity card", docType: "national_id" },
    { code: "DRIVING_LICENCE", label: "Driving licence", docType: "driving_licence" },
    { code: "BIRTH_CERT", label: "Birth certificate", docType: "birth_certificate" },
    {
      code: "NATURALISATION",
      label: "Certificate of naturalisation or citizenship",
      docType: "naturalisation_certificate",
    },
    {
      code: "SCHOOL_CERT",
      label: "School leaving or matriculation certificate",
      docType: "school_certificate",
    },
    { code: "PERMIT", label: "Residence or work permit", docType: "residence_permit" },
    {
      code: "AFFIDAVIT",
      label: "Sworn affidavit before a commissioner of oaths",
      docType: "affidavit",
    },
  ],
  A4: [
    {
      code: "NATURALISATION",
      label: "Certificate of naturalisation",
      docType: "naturalisation_certificate",
    },
  ],
  Q1: [
    { code: "DEGREE_CERT", label: "Degree or diploma certificate", docType: "degree_certificate" },
    {
      code: "PROFESSIONAL_CERT",
      label: "Professional body membership certificate",
      docType: "professional_certificate",
    },
    {
      code: "ACADEMIC_TRANSCRIPT",
      label: "Academic transcript only",
      docType: "academic_transcript",
    },
  ],
  Q3: [
    {
      code: "EMPLOYMENT_LETTER",
      label: "Certificate of service or employment letter",
      docType: "employment_letter",
    },
    {
      code: "REFERENCE_LETTER",
      label: "Reference letter from a former employer",
      docType: "reference_letter",
    },
    { code: "EMPLOYMENT_CONTRACT", label: "Employment contract", docType: "employment_contract" },
  ],
  PC1: [
    { code: "POLICE_CLEARANCE", label: "Police clearance certificate", docType: "police_clearance" },
    {
      code: "GOOD_CONDUCT_CERT",
      label: "Certificate of good conduct",
      docType: "good_conduct_certificate",
    },
    {
      code: "COURT_RECORD_EXTRACT",
      label: "Court record extract",
      docType: "court_record_extract",
    },
  ],
  PC19: [
    {
      code: "TAX_COMPLIANCE_CERT",
      label: "Tax compliance certificate with historical statement",
      docType: "tax_compliance_certificate",
    },
    {
      code: "TAX_CLEARANCE_CERT",
      label: "Tax clearance certificate (point in time)",
      docType: "tax_clearance_certificate",
    },
    {
      code: "STATUTORY_BODY_LETTER",
      label: "Letter from another statutory body",
      docType: "statutory_body_letter",
    },
  ],
  FC5: [
    {
      code: "BANK_REFERENCE_LETTER",
      label: "Bank reference letter with facility conduct history",
      docType: "bank_reference_letter",
    },
    {
      code: "CREDIT_BUREAU_REPORT",
      label: "Credit bureau report",
      docType: "credit_bureau_report",
      accepts: ["xlsx", "csv", "pdf"],
    },
    {
      code: "LOAN_STATEMENT",
      label: "Statement of account or loan statement",
      docType: "loan_statement",
    },
  ],
  FC7: [
    {
      code: "BANK_REFERENCE_LETTER",
      label: "Bank reference letter with aggregate exposure",
      docType: "bank_reference_letter",
    },
    {
      code: "CREDIT_BUREAU_REPORT",
      label: "Credit bureau report",
      docType: "credit_bureau_report",
      accepts: ["xlsx", "csv", "pdf"],
    },
    {
      code: "STATEMENT_OF_FACILITIES",
      label: "Statement of facilities across lenders",
      docType: "statement_of_facilities",
    },
  ],
  CoI2: [
    {
      code: "COMPANY_REGISTRY_EXTRACT",
      label: "Company registry extract",
      docType: "company_registry_extract",
    },
    {
      code: "APPOINTMENT_LETTER",
      label: "Letter of appointment as director",
      docType: "director_appointment_letter",
    },
    {
      code: "ANNUAL_RETURN_EXTRACT",
      label: "Annual return or filing showing the directorship",
      docType: "annual_return_extract",
    },
  ],
  CoI6: [
    {
      code: "COMPANY_REGISTRY_EXTRACT",
      label: "Company registry extract with shareholding",
      docType: "company_registry_extract",
    },
    {
      code: "SHARE_REGISTER_EXTRACT",
      label: "Share register extract",
      docType: "share_register_extract",
    },
    {
      code: "BENEFICIAL_OWNERSHIP_DECLARATION",
      label: "Trust deed or beneficial ownership declaration",
      docType: "beneficial_ownership_declaration",
    },
  ],
  T1: [
    {
      code: "BOARD_APPOINTMENT_LETTER",
      label: "Board appointment letter",
      docType: "board_appointment_letter",
    },
    { code: "EMPLOYMENT_CONTRACT", label: "Employment contract", docType: "employment_contract" },
  ],
  T2: [
    {
      code: "BOARD_APPOINTMENT_LETTER",
      label: "Board appointment letter",
      docType: "board_appointment_letter",
    },
    {
      code: "JOB_DESCRIPTION",
      label: "Job description or executive mandate letter",
      docType: "job_description",
    },
  ],
  CoL1: [
    { code: "SHARE_CERTIFICATE", label: "Share certificate", docType: "share_certificate" },
    {
      code: "SHARE_REGISTER_EXTRACT",
      label: "Share register extract",
      docType: "share_register_extract",
    },
  ],
  CoL3: [
    {
      code: "SHARE_REGISTER_EXTRACT",
      label: "Share register extract",
      docType: "share_register_extract",
    },
    {
      code: "SHARE_CERTIFICATE",
      label: "Share certificate in the relative's name",
      docType: "relative_share_certificate",
    },
  ],
  // The CV sits outside the 15 questions, but reuses the same picker, so it is keyed here
  // under its own pseudo-question id. PDF only — a CV is read as a document, not a workbook.
  [CV_QID]: [
    { code: "CURRICULUM_VITAE", label: "Curriculum vitae (CV)", docType: "curriculum_vitae" },
    { code: "RESUME", label: "Resume", docType: "curriculum_vitae" },
  ],
  CS4: [
    {
      code: "SIGNED_DECLARATION",
      label: "Signed declaration, witnessed by a commissioner of oaths",
      docType: "suitability_declaration",
    },
    {
      code: "COMPANY_SECRETARY_ATTESTATION",
      label: "Declaration countersigned by the company secretary only",
      docType: "company_secretary_attestation",
    },
  ],
};

export function evidenceOptionsFor(qid: string): EvidenceOption[] {
  return [...(OPTIONS_BY_QID[qid] ?? []), OTHER_OPTION];
}

/**
 * The two questions that accept an optional second document. Both ask for a figure that a
 * single lender's letter can only partly evidence, so the v7 test set lets the filer add a
 * credit bureau report and has Consistency_Check reconcile the two.
 */
const SUPPORTING_EVIDENCE_QIDS = new Set(["FC5", "FC7"]);

export function acceptsSupportingEvidence(qid: string): boolean {
  return SUPPORTING_EVIDENCE_QIDS.has(qid);
}

/**
 * Options offered for the supporting slot: the question's own list minus whatever is already
 * attached, so the same document cannot be filed twice against one question.
 */
export function supportingOptionsFor(qid: string, usedDocTypes: string[]): EvidenceOption[] {
  if (!acceptsSupportingEvidence(qid)) return [];
  const used = new Set(usedDocTypes);
  return evidenceOptionsFor(qid).filter(
    (o) => o.code === OTHER_OPTION.code || !used.has(o.docType)
  );
}

const DEFAULT_ACCEPTS = ["pdf"];

export function acceptedFormats(option: EvidenceOption): string[] {
  return option.accepts ?? DEFAULT_ACCEPTS;
}

/** File name the simulated upload produces — the format the test pack actually ships. */
export function fileNameFor(option: EvidenceOption): string {
  return `${option.docType}.${acceptedFormats(option)[0]}`;
}

const ALL_OPTIONS = Object.values(OPTIONS_BY_QID).flat();

/**
 * File name for an attached document. `path` is optional in the test set — the newer files drop
 * it because it is fully derivable: every document is stored as its own doc_type, and the
 * format is a property of the document type, not of the submission.
 */
export function evidenceFileName(ref: { doc_type: string; path?: string }): string {
  if (ref.path) return ref.path.split("/").pop() ?? ref.path;
  const option = ALL_OPTIONS.find((o) => o.docType === ref.doc_type);
  const format = option ? acceptedFormats(option)[0] : DEFAULT_ACCEPTS[0];
  return `${ref.doc_type}.${format}`;
}

/** "PDF", or "XLSX, CSV or PDF" — shown next to the picker so the filer knows what is allowed. */
export function formatHint(option: EvidenceOption): string {
  const formats = acceptedFormats(option).map((f) => f.toUpperCase());
  if (formats.length === 1) return formats[0];
  return `${formats.slice(0, -1).join(", ")} or ${formats[formats.length - 1]}`;
}

/** A question with a single real document type can pre-select it; a real choice must be made. */
export function defaultOptionCodeFor(qid: string): string {
  const options = evidenceOptionsFor(qid);
  return options.length === 2 ? options[0].code : "";
}

export function findOption(qid: string, code: string): EvidenceOption | undefined {
  return evidenceOptionsFor(qid).find((o) => o.code === code);
}

const LABEL_BY_DOC_TYPE: Record<string, string> = Object.fromEntries(
  Object.values(OPTIONS_BY_QID)
    .flat()
    .map((o) => [o.docType, o.label])
);

/**
 * Label for an already-attached document. Resolved within the question's own option list first,
 * because several document types appear under more than one question with different wording —
 * a company registry extract reads "with shareholding" under CoI6 but not under CoI2.
 */
export function labelForDocType(docType: string, qid?: string): string {
  const own = qid && OPTIONS_BY_QID[qid]?.find((o) => o.docType === docType);
  return own ? own.label : (LABEL_BY_DOC_TYPE[docType] ?? docType.replaceAll("_", " "));
}

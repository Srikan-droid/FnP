export interface EvidenceOption {
  code: string;
  label: string;
  docType: string;
}

export const OTHER_OPTION: EvidenceOption = {
  code: "OTHER",
  label: "Other — please specify",
  docType: "other_document",
};

// Basic Details is the only section with a real choice of documents. Ported verbatim from the
// "Evidence Options" sheet of fnp_authentication_testset_v2.xlsx.
const BASIC_DETAILS_OPTIONS: Record<string, EvidenceOption[]> = {
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
};

// Every other question still takes one fixed document type, so its dropdown offers that type
// plus Other. Labels are the reader-facing names for those fixed types.
const FIXED_OPTIONS: Record<string, EvidenceOption> = {
  Q1: {
    code: "DEGREE_CERT",
    label: "Degree or professional qualification certificate",
    docType: "degree_certificate",
  },
  Q3: { code: "EMPLOYMENT_LETTER", label: "Employment or service letter", docType: "employment_letter" },
  PC1: { code: "POLICE_CLEARANCE", label: "Police clearance certificate", docType: "police_clearance" },
  PC19: {
    code: "TAX_CERT",
    label: "Tax compliance certificate",
    docType: "tax_compliance_certificate",
  },
  FC5: { code: "BANK_LETTER", label: "Bank reference letter", docType: "bank_reference_letter" },
  FC7: { code: "BANK_LETTER", label: "Bank reference letter", docType: "bank_reference_letter" },
  CoI2: {
    code: "REGISTRY_EXTRACT",
    label: "Company registry extract",
    docType: "company_registry_extract",
  },
  CoI6: {
    code: "REGISTRY_EXTRACT",
    label: "Company registry extract",
    docType: "company_registry_extract",
  },
  T1: {
    code: "BOARD_LETTER",
    label: "Board appointment letter",
    docType: "board_appointment_letter",
  },
  T2: {
    code: "BOARD_LETTER",
    label: "Board appointment letter",
    docType: "board_appointment_letter",
  },
  CoL1: { code: "SHARE_CERT", label: "Share certificate", docType: "share_certificate" },
  CoL3: {
    code: "SHARE_REGISTER",
    label: "Share register extract",
    docType: "share_register_extract",
  },
  CS4: {
    code: "SUITABILITY_DECLARATION",
    label: "Signed suitability declaration",
    docType: "suitability_declaration",
  },
};

export function evidenceOptionsFor(qid: string): EvidenceOption[] {
  const options = BASIC_DETAILS_OPTIONS[qid] ?? (FIXED_OPTIONS[qid] ? [FIXED_OPTIONS[qid]] : []);
  return [...options, OTHER_OPTION];
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
  [...Object.values(BASIC_DETAILS_OPTIONS).flat(), ...Object.values(FIXED_OPTIONS)].map((o) => [
    o.docType,
    o.label,
  ])
);

/** Label for an already-attached document, including drafts saved before the dropdown existed. */
export function labelForDocType(docType: string): string {
  return LABEL_BY_DOC_TYPE[docType] ?? docType.replaceAll("_", " ");
}

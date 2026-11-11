export type Answer = "Yes" | "No" | "N/A";

/**
 * "supporting" is the optional second document FC5 and FC7 accept. It exists only to be
 * reconciled against the primary by Consistency_Check, so it never stands on its own.
 */
export type EvidenceRole = "primary" | "supporting";

/** One uploaded document, as the form shows it. */
export interface EvidenceRef {
  /** The backend's id for the document, used to remove it. */
  id: string;
  doc_type: string;
  role: EvidenceRole;
  /** Dropdown option the filer picked. */
  option_code: string;
  /** What the filer typed when they picked "Other — please specify". */
  description: string;
  /** The name of the file the filer uploaded. */
  fileName: string;
  /** Where the document can be opened (access-checked by the backend). */
  url: string;
  /** Its copy in "Your documents" (null from an older server): the same document on two questions shares it. */
  documentId?: string | null;
}

export interface ResponseItem {
  qid: string;
  section: string;
  question: string;
  /** Yes, No or N/A; for a text question, the words given ("" until answered). */
  answer: string;
  answerType: "choice" | "text";
  evidence_required: boolean;
  evidence: EvidenceRef[];
  /** Named checks the authentication engine runs for this question (v2 test set). */
  checks_to_perform: string[];
  /** A follow-up question: the question it follows on from and the answer that asks it. */
  parentQid?: string | null;
  showWhen?: string | null;
}

/**
 * The CV is a supplementary artifact: mandatory for every applicant, but outside the 15
 * questions and the 8 sections, unweighted, and carrying no knockout.
 */
export interface CvSubmission {
  doc_type: string;
  mandatory: boolean;
  evidence: EvidenceRef[];
  checks_to_perform: string[];
}

type CvConsistencyVerdict = "CONSISTENT" | "EVIDENCE_CONFLICT";
type CvSuitabilityVerdict = "NO_CONCERN" | "SUITABILITY_FLAG";
type CvVerdict = CvConsistencyVerdict | CvSuitabilityVerdict;

export interface CvFinding {
  /** qualification | experience | directorships, or sector_relevance | seniority_level | career_gaps */
  aspect: string;
  verdict: CvVerdict;
  confidence: number;
  detail: string;
}

export interface CvVerificationResult {
  docType: string;
  /** "analyzed" once the CV has been read; "not_submitted" when none is attached. */
  status: "analyzed" | "not_submitted";
  /** Document_Check and Name_Check, run before the analysis the same as any other question. */
  gateChecks: CheckResult[];
  consistencyFindings: CvFinding[];
  suitabilityFindings: CvFinding[];
  flagCount: number;
}

/** Who the applicant is, from the assessment record. Personal details are not collected. */
export interface ApplicantDetails {
  full_name: string;
  proposed_role: string;
}

export interface ApplicationForm {
  application_id: string;
  licensee: string;
  applicant: ApplicantDetails;
  submitted_at: string;
  responses: ResponseItem[];
  cv_verification?: CvSubmission;
}

export type CheckStatus = "pass" | "caution" | "fail";

export interface CheckResult {
  name: string;
  label: string;
  status: CheckStatus;
  /** 0–1. Low confidence is how a failed or shaky check announces itself. */
  confidence: number;
  note: string;
}

type QuestionAuthStatus = "authenticated" | "issue" | "not_checked";

export interface QuestionAuthResult {
  qid: string;
  question: string;
  answer: Answer;
  status: QuestionAuthStatus;
  checks: CheckResult[];
  /** Weakest check carries the question. Null when no checks ran. */
  confidence: number | null;
  summary: string;
  /** The engine's own reading of the evidence, with a link to the passage it relied on. */
  determination?: { verdict: string | null; highlightUrl: string | null } | null;
}

export interface SectionAuthResult {
  section: string;
  issueCount: number;
  questions: QuestionAuthResult[];
}

export interface AuthenticationOutcome {
  assessmentId: string;
  sections: SectionAuthResult[];
  isClean: boolean;
  overallConfidence: number | null;
  /**
   * The 15-question checks only. CV checks are excluded deliberately: the CV is reviewer-facing
   * and must not move any authentication figure.
   */
  checksRun: number;
  cvVerification: CvVerificationResult | null;
}

export interface SectionScoreLine {
  qid: string;
  section: string;
  question: string;
  answer: Answer;
  polarity: "Positive" | "Negative";
  questionWeight: number;
  riskFlag: 0 | 1;
  applicableWeight: number;
  weightedRisk: number;
  isKnockOut: boolean;
  knockOutTriggered: boolean;
}

export type Band = "Low" | "Moderate" | "Elevated" | "High";

export interface ScoreResult {
  applicationId: string;
  lines: SectionScoreLine[];
  totalApplicableWeight: number;
  totalWeightedRisk: number;
  normalisedRiskScore: number;
  riskScore100: number;
  band: Band;
  knockOutTriggered: boolean;
  knockOutReason?: string;
  recommendation: string;
}

export type Answer = "Yes" | "No" | "N/A";

/**
 * "supporting" is the optional second document FC5 and FC7 accept. It exists only to be
 * reconciled against the primary by Consistency_Check, so it never stands on its own.
 */
export type EvidenceRole = "primary" | "supporting";

export interface EvidenceRef {
  doc_type: string;
  /** Optional: derivable from doc_type, and the newer test set files omit it. */
  path?: string;
  /** Absent on drafts seeded before roles existed; treat as "primary". */
  role?: EvidenceRole;
  /** Dropdown option the filer picked. Absent on drafts seeded from the source test set. */
  option_code?: string;
  /** What the filer typed when they picked "Other — please specify". */
  description?: string;
}

export interface ResponseItem {
  qid: string;
  section: string;
  question: string;
  answer: Answer;
  evidence_required: boolean;
  evidence: EvidenceRef[];
  /** Named checks the authentication engine runs for this question (v2 test set). */
  checks_to_perform: string[];
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

export type CvConsistencyVerdict = "CONSISTENT" | "EVIDENCE_CONFLICT";
export type CvSuitabilityVerdict = "NO_CONCERN" | "SUITABILITY_FLAG";
export type CvVerdict = CvConsistencyVerdict | CvSuitabilityVerdict;

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
  scoringImpact: string;
}

export interface ApplicationForm {
  application_id: string;
  licensee: string;
  applicant: {
    full_name: string;
    proposed_role: string;
    date_of_birth: string;
    town: string;
  };
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

export type QuestionAuthStatus = "authenticated" | "issue" | "not_checked";

export interface QuestionAuthResult {
  qid: string;
  question: string;
  answer: Answer;
  status: QuestionAuthStatus;
  checks: CheckResult[];
  /** Weakest check carries the question. Null when no checks ran. */
  confidence: number | null;
  summary: string;
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

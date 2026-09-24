export type Answer = "Yes" | "No" | "N/A";

export interface EvidenceRef {
  doc_type: string;
  path: string;
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
  section: string;
  question: string;
  answer: Answer;
  status: QuestionAuthStatus;
  checks: CheckResult[];
  /** Weakest check carries the question. Null when no checks ran. */
  confidence: number | null;
  summary: string;
}

export interface AuthenticationOutcome {
  assessmentId: string;
  questions: QuestionAuthResult[];
  issues: QuestionAuthResult[];
  isClean: boolean;
  overallConfidence: number | null;
  checksRun: number;
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

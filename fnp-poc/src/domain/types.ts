export type Answer = "Yes" | "No" | "N/A";

export type Verdict =
  | "MATCH"
  | "MATCH_VARIANT"
  | "MISMATCH"
  | "CONTRADICTION"
  | "UNVERIFIABLE"
  | "EVIDENCE_MISSING";

export interface EvidenceRef {
  doc_type: string;
  path: string;
}

export interface ResponseItem {
  qid: string;
  section: string;
  question: string;
  answer: Answer;
  declared_values: Record<string, string | number | boolean>;
  evidence_required: boolean;
  evidence: EvidenceRef[];
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

export interface FieldExpectation {
  qid: string;
  field: string;
  declared: string | number;
  in_evidence: string | number;
  doc_type: string;
  expected: Verdict;
  note: string;
}

export interface AuthenticationFieldResult extends FieldExpectation {}

export interface AuthenticationResult {
  applicationId: string;
  isClean: boolean;
  fields: AuthenticationFieldResult[];
  blockingFields: AuthenticationFieldResult[];
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

export interface AssessmentReport {
  applicationId: string;
  applicantName: string;
  proposedRole: string;
  licensee: string;
  generatedAt: string;
  authentication: AuthenticationResult;
  score: ScoreResult | null;
}

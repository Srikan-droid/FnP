import app001 from "../data/assessments/APP001.json";

/**
 * The narrative assessment the backend produces after scoring: a supervisor-facing write-up of
 * the determination, the concerns that drove it and the conditions proposed against each.
 *
 * Only APP001 has one in this pack; the others are pending, and the page says so rather than
 * hiding the entry point.
 */
export interface AssessmentConcern {
  qid: string;
  section: string;
  severity: string;
  risk_type: string;
  statement: string;
  condition_id: string;
  condition: string;
  quote: string;
  evidence_url: string;
}

export interface FinalAssessment {
  application_id: string;
  request_id: string;
  applicant: { full_name: string; proposed_role: string };
  licensee: string;
  determination: {
    verdict: string;
    recommendation: string;
    risk_score: number;
    risk_band: string;
    weighted_risk: string;
    knock_out_triggered: boolean;
  };
  executive_summary: string;
  concerns: AssessmentConcern[];
  strengths: { qid: string; statement: string }[];
  for_supervisor: string[];
  questions: { passed: string; conditional: string; not_applicable: string };
  evidence: {
    documents_read: number;
    questions_verified: number;
    questions_self_declared: number;
  };
  assessment: {
    version: string;
    generated_at: string;
    inputs_digest: string;
    rules_version: string;
    narrative_generated: boolean;
  };
}

const ASSESSMENTS: Record<string, FinalAssessment> = {
  APP001: app001 as FinalAssessment,
};

export function finalAssessmentFor(applicantId: string): FinalAssessment | null {
  return ASSESSMENTS[applicantId] ?? null;
}

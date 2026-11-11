/**
 * Turns backend responses into the shapes the screens render. Keeping the screens' own types means
 * the report, form and score components did not have to change to read live data.
 */
import type {
  ApplicantDetails,
  ApplicationForm,
  AuthenticationOutcome,
  EvidenceRef,
  QuestionAuthResult,
  ScoreResult,
} from "../domain/types";
import type { AnswerType, ApplicantInfo, Assessment, Case, Catalogue, EvidenceItem, EvidenceRule, Form } from "./types";
import { askedQids } from "../domain/followUps";

/** One uploaded document as the form shows it. */
export function evidenceRef(item: EvidenceItem): EvidenceRef {
  return {
    id: item.id,
    doc_type: item.docType,
    role: item.role,
    option_code: item.optionCode,
    description: item.description,
    fileName: item.fileName,
    url: item.url,
    documentId: item.documentId ?? null,
  };
}

/**
 * The API's name for each applicant detail the screens show. The one place the two namings meet:
 * reading the form goes through it.
 */
export const APPLICANT_API_FIELD = {
  full_name: "fullName",
  proposed_role: "proposedRole",
} as const satisfies Record<keyof ApplicantDetails, keyof ApplicantInfo>;

/** The applicant's declared details as the details card and summaries render them. */
export function toApplicantDetails(form: Form): ApplicantDetails {
  const entries = Object.entries(APPLICANT_API_FIELD).map(([key, api]) => [key, form.applicant[api]]);
  return Object.fromEntries(entries) as unknown as ApplicantDetails;
}

/** Whether an answer needs a document, by the question's rule (the backend's evidence_required). */
export function evidenceNeeded(rule: EvidenceRule, answerType: AnswerType, answer: string): boolean {
  if (rule === "never") return false;
  if (answerType === "text") return rule === "always";
  return answer !== "N/A" && (rule === "always" || answer === "Yes");
}

/**
 * The form as the screens know it: one response per question, in catalogue order. Only the
 * questions this assessment's form has are included: the catalogue is the active version and may
 * be a few minutes old, so it is not assumed to match the form question for question.
 *
 * A follow-up question its parent's answer does not ask is left out, so every count, check and
 * list on the screens leaves it out too; it comes back the moment the parent's answer asks it.
 */
export function toApplicationForm(form: Form, catalogue: Catalogue, assessment: Assessment): ApplicationForm {
  const answers = new Map(form.answers.map((a) => [a.qid, a]));
  const asked = askedQids(form.answers);
  const evidenceFor = (qid: string) => form.evidence.filter((e) => e.qid === qid).map(evidenceRef);
  return {
    application_id: assessment.id,
    licensee: assessment.entity,
    applicant: toApplicantDetails(form),
    submitted_at: assessment.submittedAt ?? "",
    responses: catalogue.questions.flatMap((q) => {
      const saved = answers.get(q.qid);
      if (saved === undefined || !asked.has(q.qid)) return [];
      const answer = saved.value;
      const answerType = saved.answerType ?? "choice";
      return [
        {
          qid: q.qid,
          section: q.section,
          question: q.text,
          answer,
          answerType,
          // The assessment's own rule, which the backend enforces; the catalogue is the active
          // version and may differ. Computed from the answer so a change shows at once.
          evidence_required: evidenceNeeded(saved.evidenceRule, answerType, answer),
          evidence: evidenceFor(q.qid),
          checks_to_perform: q.checks,
          parentQid: saved.parentQid ?? null,
          showWhen: saved.showWhen ?? null,
        },
      ];
    }),
    cv_verification: {
      doc_type: "curriculum_vitae",
      mandatory: true,
      evidence: evidenceFor("CV"),
      checks_to_perform: ["Document_Check", "Name_Check"],
    },
  };
}

/** The engine's authentication result, as the report renders it. */
export function toOutcome(assessmentId: string, data: Case): AuthenticationOutcome | null {
  const auth = data.authentication;
  if (!auth) return null;
  return {
    assessmentId,
    sections: auth.sections,
    isClean: auth.isClean,
    overallConfidence: auth.overallConfidence,
    checksRun: auth.checksRun,
    cvVerification: auth.cvVerification,
  };
}

/** The score, with the totals the report shows. */
export function toScoreResult(assessmentId: string, data: Case): ScoreResult | null {
  const score = data.score;
  if (!score) return null;
  const triggered = score.lines.find((l) => l.knockOutTriggered);
  return {
    applicationId: assessmentId,
    lines: score.lines,
    totalApplicableWeight: score.lines.reduce((sum, l) => sum + l.applicableWeight, 0),
    totalWeightedRisk: score.lines.reduce((sum, l) => sum + l.weightedRisk, 0),
    normalisedRiskScore: score.normalised,
    riskScore100: score.riskScore,
    band: score.band,
    knockOutTriggered: score.knockOut,
    knockOutReason: triggered ? `${triggered.qid}: ${triggered.question}` : undefined,
    recommendation: score.recommendation,
  };
}

/** What the applicant and reviewer see against one question on the report. */
export type QuestionReviewState = "clean" | "flagged" | "overridden" | "rejected";

export function reviewStateFor(data: Case, qid: string): QuestionReviewState {
  if (!data.flags.includes(qid)) return "clean";
  const ruling = data.rulings[qid];
  if (!ruling) return "flagged";
  return ruling.verdict === "accepted" ? "overridden" : "rejected";
}

/** Every question on the authentication report, in report order. */
export function reportQuestions(outcome: Pick<AuthenticationOutcome, "sections">): QuestionAuthResult[] {
  return outcome.sections.flatMap((s) => s.questions);
}

/** The questions the engine could not authenticate, in report order. */
export function questionsWithIssues(outcome: Pick<AuthenticationOutcome, "sections">): QuestionAuthResult[] {
  return reportQuestions(outcome).filter((q) => q.status === "issue");
}

/** Flags the reviewer has not ruled on yet, in report order. */
export function unresolvedFlags(data: Case): string[] {
  return data.flags.filter((qid) => !data.rulings[qid]);
}

/** The backend's response shapes (backend/cases/views). */

import type { Answer, CheckResult, CvFinding, EvidenceRole } from "../domain/types";

/** The side of the app an account uses: applying, or reviewing (an admin or the super user). */
export type Role = "applicant" | "reviewer";
/** What an account is: a user (applies), an admin of some departments, or the super user. */
export type Access = "user" | "admin" | "superuser";
/** An account's role as stored: an admin is a "reviewer". */
export type AccountRole = "applicant" | "reviewer" | "superuser";

export interface SessionUser {
  email: string;
  role: Role;
  /** Missing from a session read before roles had kinds: treated as before (a user, or an admin). */
  access?: Access;
  /** On the reviewer side: the departments they work on (every one for the super user). */
  departments?: { key: string; name: string }[];
}

export type Stage =
  | "NOT_SUBMITTED"
  | "AUTH_RUNNING"
  | "AUTH_FAILED"
  | "REVIEW_PENDING"
  | "AWAITING_APPLICANT"
  | "SCORING"
  | "DECISION_PENDING"
  | "ACCEPTED"
  | "REJECTED";

/** The admin reviewing a case, and since when they have it. */
export interface CaseReviewer {
  email: string;
  since: string | null;
}

export interface Department {
  key: string;
  name: string;
  blurb: string;
  /** False for a department switched off: it takes no new applications. */
  isActive?: boolean;
  /** False while it has no questions: it takes no applications until its admins set some up. */
  hasQuestions?: boolean;
}

export interface Assessment {
  id: string;
  applicantName: string;
  applicantEmail: string;
  department: Department;
  entity: string;
  position: string;
  reference: string;
  initiatedOn: string;
  stage: Stage;
  submittedAt: string | null;
  decidedAt: string | null;
  updatedAt: string;
  /** When it reached its stage (left out by an older server): how long it has waited there. */
  stageSince?: string;
  /** Whether the person viewing it may remove it (only before submission). */
  removable: boolean;
  /** An applicant's form not submitted yet: documents attached of those it needs. */
  progress?: {
    documentsNeeded: number;
    documentsAttached: number;
    /** Questions answered in words still blank (submitting waits for them too). */
    answersMissing?: number;
  };
  /** The viewer's own application: a reviewer may not rule on or decide it. */
  ownApplication: boolean;
  /** Started by the applicant themselves, rather than opened for them by the reviewer. */
  startedByApplicant: boolean;
  /** Whether the applicant has saved anything yet. */
  hasDraft: boolean;
  /** On the reviewer side: the admin reviewing it (null: nobody has taken it yet). */
  reviewer?: CaseReviewer | null;
  /** What the reviewer queue's cards show about the latest run. */
  queue: {
    flagged: string[];
    openFlags: number;
    rejected: string[];
    decisionRemarks: string | null;
  };
}

/** The reviewer's admin panel: the system at a glance (GET /api/admin/overview). */
export interface AdminOverview {
  generatedAt: string;
  /** The window "recently" counts cover, in days. */
  recentDays: number;
  users: {
    total: number;
    applicants: number;
    /** Admins and super users together. */
    reviewers: number;
    admins?: number;
    superUsers?: number;
    active: number;
    inactive: number;
    newRecently: number;
    signedInRecently: number;
  };
  assessments: {
    total: number;
    awaitingReviewer: number;
    submittedRecently: number;
    accepted: number;
    rejected: number;
    byStage: Record<Stage, number>;
    byDepartment: { key: string; name: string; count: number }[];
  };
  runs: { inProgress: number; failed: number };
  documents: { count: number; bytes: number };
}

/** One account as the admin panel lists it: identifiers, dates and counts only. */
export interface AdminUser {
  id: number;
  email: string;
  role: AccountRole;
  /** An admin's departments. */
  departments: { key: string; name: string }[];
  isActive: boolean;
  isStaff: boolean;
  /** The built-in admin sign-in and staff accounts: their role and status are not changed here. */
  accessFixed: boolean;
  joinedAt: string;
  lastLoginAt: string | null;
}

/** A department as the admin panel lists it. */
export interface AdminDepartment {
  key: string;
  name: string;
  blurb: string;
  isActive: boolean;
  assessmentCount: number;
  adminCount: number;
  questionCount: number;
  /** Submitted cases not decided that no admin has taken yet. */
  waitingCount?: number;
  /** Its questionnaire edition in force. */
  version: string | null;
}

export interface AdminUserRow extends AdminUser {
  assessmentCount: number;
  latestStage: Stage | null;
}

export interface AdminUserDetail extends AdminUser {
  /** The cases they are reviewing now (submitted, not decided). */
  reviewing?: number;
  /** After a change: how many of their cases went back to the queue. */
  released?: number;
  assessments: {
    id: string;
    applicantName: string;
    department: { key: string; name: string };
    position: string;
    stage: Stage;
    updatedAt: string;
    submittedAt: string | null;
    decidedAt: string | null;
    /** The ID the AI engine gave the latest run; null before the engine has given one. */
    requestId: string | null;
    runCount: number;
    runStatus: "queued" | "running" | "completed" | "failed" | null;
  }[];
  activity: { at: string; action: string; assessmentRef: string }[];
}

export interface Page<T> {
  results: T[];
  next: string | null;
  /** The reviewer queue's totals across every page, not just the ones loaded (first page only). */
  total?: number;
  /** How many of those the reviewer has to act on. */
  actionable?: number;
  /** The reviewer queue: how many cases are at each stage (department and search applied). */
  stageCounts?: Partial<Record<Stage, number>>;
}

/** When a question asks for a document: always, only for a Yes, or never. */
export type EvidenceRule = "always" | "if_yes" | "never";
export type AnswerType = "choice" | "text";

export interface CatalogueQuestion {
  qid: string;
  section: string;
  text: string;
  polarity: "Positive" | "Negative";
  weight: number;
  isKnockout: boolean;
  evidenceRequired: EvidenceRule;
  /** Answered with one of allowedAnswers ("choice"), or in words ("text"). */
  answerType: AnswerType;
  /** For a question added here: the codes of the engine's document types chosen for it. */
  evidenceOptions: string[];
  /** Added in this app's question configuration (its document types are chosen here). */
  addedHere?: boolean;
  allowsNa: boolean;
  acceptsSupporting: boolean;
  checks: string[];
  allowedAnswers: Answer[];
  fileTypes: string[];
  maxFiles: 1 | 2;
}

export interface EngineOption {
  code: string;
  label: string;
  note?: string;
  doc_type: string;
  display?: string;
  review_required?: string;
  insufficient_alone?: string;
  unprofiled?: boolean;
}

export interface QuestionnaireVersion {
  version: string;
  sections: { name: string; weight: number }[];
  questions: CatalogueQuestion[];
}

export interface Catalogue extends QuestionnaireVersion {
  cvFileTypes: string[];
  evidenceOptions: Record<string, EngineOption[]>;
  /** The largest document the server accepts, in bytes. */
  maxUploadBytes?: number;
}

/** Who is editing a department's questions now; the editor is read-only for everyone else. */
export interface QuestionnaireLock {
  email: string;
  since: string;
  /** When it lapses unless the editor keeps it alive. */
  until: string;
  /** Held by the tab that asked (an editor reloaded after a refused save keeps it). */
  thisTab?: boolean;
}

export interface QuestionnaireSettings {
  /** The department whose questionnaire this is: each department has its own. */
  department: { key: string; name: string };
  lock?: QuestionnaireLock | null;
  current: QuestionnaireVersion;
  published: QuestionnaireVersion;
  configurableFileTypes: string[];
  /** The engine's document types a question added here can take. */
  evidenceOptionChoices: { code: string; label: string }[];
  /** The engine's own document types for each of its questions, which it takes until others are chosen. */
  engineEvidenceOptions?: Record<string, string[]>;
  /** Every check a question's documents can be given (those in use on any question), in words too. */
  checkChoices?: { name: string; label: string }[];
}

/** What changing the questions reaches on the applications not yet submitted (read on applying). */
export interface QuestionnaireImpact {
  drafts: number;
  /** For each question, how many of them have an answer saved. */
  answered: Record<string, number>;
  /** For each question, how many of them have a document attached. */
  documents: Record<string, number>;
}

export interface EvidenceItem {
  id: string;
  qid: string;
  optionCode: string;
  docType: string;
  role: EvidenceRole;
  description: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  url: string;
  /** The library document it attaches (null for one attached before the library existed). */
  documentId?: string | null;
}

/** A document in the application's library ("Your documents"), and where it is attached now. */
export interface LibraryDocument {
  id: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  /** Its format, from its name: "pdf", "png" ... */
  format: string;
  uploadedAt: string;
  url: string;
  /** Its contents' SHA-256 (left out by an older server): a file already here is told by it. */
  sha256?: string;
  usedBy: { qid: string; role: EvidenceRole }[];
  /** On an upload: the same file was already there, so this is that one. */
  duplicate?: boolean;
}

/** Who the applicant is, from the assessment record. Personal details are not collected. */
export interface ApplicantInfo {
  fullName: string;
  email: string;
  proposedRole: string;
}

export interface Form {
  locked: boolean;
  /** The questionnaire edition the form is on (its department may change its questions). */
  version?: string;
  applicant: ApplicantInfo;
  /** allowedAnswers, fileTypes and maxFiles are the rules this form is checked against, always current. */
  answers: {
    qid: string;
    /** Yes, No or N/A; the words given for a text question ("" until answered). */
    value: string;
    answerType: AnswerType;
    evidenceRequired: boolean;
    /** When a document is needed: always, only for a Yes, or never. From the assessment's own version. */
    evidenceRule: EvidenceRule;
    allowedAnswers: Answer[];
    fileTypes: string[];
    maxFiles: 1 | 2;
    /** For a question added here: its document types as this form's version gives them. */
    evidenceOptions?: EngineOption[] | null;
  }[];
  evidence: EvidenceItem[];
  /** "Your documents": everything uploaded, attached or not (left out by an older server). */
  documents?: LibraryDocument[];
  /** The most documents the library holds. */
  documentsMax?: number;
  /** The formats the library takes, as its upload checks them. */
  documentsFileTypes?: string[];
}

export interface ApiQuestionResult {
  qid: string;
  question: string;
  answer: Answer;
  status: "authenticated" | "issue" | "not_checked";
  confidence: number | null;
  summary: string;
  checks: CheckResult[];
  determination: {
    engineAnswer: string | null;
    verdict: string | null;
    note: string | null;
    evidenceLine: string | null;
    highlightUrl: string | null;
  } | null;
}

export interface ApiAuthentication {
  outcome: "CLEAR" | "RETURN_TO_FILER" | null;
  isClean: boolean;
  overallConfidence: number | null;
  checksRun: number;
  questionsWithIssues: number;
  sections: { section: string; issueCount: number; questions: ApiQuestionResult[] }[];
  cvVerification: {
    docType: string;
    status: "analyzed" | "not_submitted";
    gateChecks: CheckResult[];
    consistencyFindings: CvFinding[];
    suitabilityFindings: CvFinding[];
    flagCount: number;
  } | null;
}

export interface ApiScore {
  source: "engine" | "backend_override";
  riskScore: number;
  normalised: number;
  band: "Low" | "Moderate" | "Elevated" | "High";
  knockOut: boolean;
  recommendation: string;
  lines: {
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
  }[];
}

/** The reviewer's call on a flagged answer, or on the scored assessment. */
export type Verdict = "accepted" | "rejected";

export interface Ruling {
  verdict: Verdict;
  comment: string;
  at: string;
}

/** One ruling in a question's history across the case's runs (Case.reviewHistory). */
export interface ReviewEntry extends Ruling {
  /** The reviewer's account, for a reviewer; null for an applicant. */
  by: string | null;
  /** The submission version the ruling was made on: "v1", "v2" ... */
  run: string;
  /** Made on the latest run (the one scored), rather than an earlier one. */
  current: boolean;
  /** That run was scored at the reviewer's request although it did not authenticate CLEAR. */
  scoreForced: boolean;
}

export interface Case {
  stage: Stage;
  /** On the reviewer side: who reviews it; only they rule on it and decide it (null: not taken). */
  reviewer?: CaseReviewer | null;
  submittedAt: string | null;
  decidedAt: string | null;
  run: {
    attempt: number;
    status: "queued" | "running" | "completed" | "failed";
    outcome: "CLEAR" | "RETURN_TO_FILER" | null;
    submittedAt: string;
    authenticatedAt: string | null;
    completedAt: string | null;
    /** Failed without the engine confirming it received the run: it may still be working on it,
     * and sending again starts a second run. */
    unconfirmed: boolean;
    /** Scored at the reviewer's request after they accepted every flagged answer (force-score). */
    scoreForced: boolean;
    scoreForcedAt: string | null;
    /** Why the AI engine did not score it when asked, if it did not. */
    forceScoreError: string | null;
    /** Whether the reviewer may ask the AI engine to score it (again). */
    canForceScore: boolean;
  } | null;
  authentication: ApiAuthentication | null;
  flags: string[];
  rulings: Record<string, Ruling>;
  /** Each question's rulings across every run, oldest first (left out by an older server). */
  reviewHistory?: Record<string, ReviewEntry[]>;
  rejected: string[];
  /** Rejected answers with no new document since the run they were rejected in. */
  unreplaced: string[];
  /** Under review, once every flagged answer has a ruling: "accept" (all accepted: on to scoring)
   * or "return" (any rejected: back to the applicant). Null until then. */
  reviewOutcome: "accept" | "return" | null;
  score: ApiScore | null;
  /** The engine's written assessment, links already pointing at this backend. */
  assessment: FinalAssessment | null;
  /**
   * `by`: the account that decided it (its email), for a reviewer; null for an applicant, who is
   * not shown a reviewer's sign-in (and left out by an older server).
   */
  decision: { verdict: Verdict; remarks: string; at: string; by?: string | null } | null;
}

/**
 * The engine's written assessment of a CLEAR submission: the determination, the concerns that drove
 * it and the conditions proposed against each. Its links already point at this backend.
 */
export interface FinalAssessment {
  application_id: string;
  applicant: { full_name: string; proposed_role: string };
  licensee: string;
  determination: {
    verdict: string;
    recommendation: string;
    risk_score: number;
    risk_band: string;
    weighted_risk: string;
    knock_out_triggered: boolean;
    /** Present when a reviewer forced a run that did not authenticate CLEAR on to scoring. */
    authentication_override?: {
      note?: string;
      forced_at?: string;
      is_score_forced?: boolean;
      original_outcome?: string;
    };
  };
  // The engine leaves out a part it has nothing for (no question was not applicable, say), so every
  // part below may be missing.
  executive_summary?: string;
  concerns?: {
    qid: string;
    section: string;
    severity: string;
    risk_type: string;
    statement: string;
    /** The proposed condition: newer engine versions may leave it out. */
    condition_id?: string;
    condition?: string;
    quote?: string;
    evidence_url?: string | null;
  }[];
  strengths?: { qid: string; statement: string }[];
  for_supervisor?: string[];
  /** Question ids per outcome, as "A1, A4, Q1" (or a list); an outcome with none may be missing. */
  questions?: { passed?: string | string[]; conditional?: string | string[]; not_applicable?: string | string[] };
  evidence?: { documents_read?: number; questions_verified?: number; questions_self_declared?: number };
  assessment?: {
    version: string;
    generated_at: string;
    inputs_digest: string;
    rules_version: string;
    narrative_generated: boolean;
  };
}

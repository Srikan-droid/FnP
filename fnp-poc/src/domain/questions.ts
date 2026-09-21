export interface QuestionDef {
  qid: string;
  section: string;
  sectionWeight: number;
  question: string;
  polarity: "Positive" | "Negative";
  questionWeight: number;
  isKnockOut: boolean;
}

// Ported verbatim from fnp_scoring_model_15q.xlsx ("Scoring Model" sheet).
export const QUESTIONS: QuestionDef[] = [
  {
    qid: "A1",
    section: "Age",
    sectionWeight: 4,
    question: "Is the applicant between 45–60 years of age?",
    polarity: "Positive",
    questionWeight: 2.5,
    isKnockOut: false,
  },
  {
    qid: "A4",
    section: "Age",
    sectionWeight: 4,
    question: "Is the applicant a naturalized citizen?",
    polarity: "Positive",
    questionWeight: 1.5,
    isKnockOut: false,
  },
  {
    qid: "Q1",
    section: "Qualifications & Experience",
    sectionWeight: 18,
    question: "Does the applicant hold a relevant academic qualification?",
    polarity: "Positive",
    questionWeight: 6,
    isKnockOut: false,
  },
  {
    qid: "Q3",
    section: "Qualifications & Experience",
    sectionWeight: 18,
    question: "Does the applicant have ≥10 years relevant experience?",
    polarity: "Positive",
    questionWeight: 12,
    isKnockOut: false,
  },
  {
    qid: "PC1",
    section: "Professional Conduct /Reputation/Integrity",
    sectionWeight: 26,
    question:
      "Have you at any time been charged with or convicted of any offence or otherwise found liable by a Civil, Criminal or Military Court (excluding minor road traffic offences) whether in Jamaica or elsewhere?",
    polarity: "Negative",
    questionWeight: 18,
    isKnockOut: true,
  },
  {
    qid: "PC19",
    section: "Professional Conduct /Reputation/Integrity",
    sectionWeight: 26,
    question:
      "Was there a time when you were not in compliance with any tax or other statutory requirements imposed on you? (Section 3(1)(iii) of the Act)",
    polarity: "Negative",
    questionWeight: 8,
    isKnockOut: false,
  },
  {
    qid: "FC5",
    section: "Financial Soundness",
    sectionWeight: 16,
    question:
      "Has any loan or credit facility (or part thereof) extended to you by any financial institution, been restructured, renegotiated, provided against or been the subject of a write-off or debt forgiveness for reasons of non-payment by you?",
    polarity: "Negative",
    questionWeight: 10,
    isKnockOut: false,
  },
  {
    qid: "FC7",
    section: "Financial Soundness",
    sectionWeight: 16,
    question:
      "Do you (in your personal capacity), or through any legal person or arrangement controlled by you and/or any immediate relative have outstanding any loans or other forms of indebtedness (including guarantees) in excess of J$2.5mn?",
    polarity: "Negative",
    questionWeight: 6,
    isKnockOut: false,
  },
  {
    qid: "CoI2",
    section: "Conflict of interest. (Entity/Enterprise based)",
    sectionWeight: 14,
    question:
      "Have you ever been or are you currently a Director of any limited liability companies, societies, or other business enterprises engaged in financial services, as defined in the BSA?",
    polarity: "Negative",
    questionWeight: 5,
    isKnockOut: false,
  },
  {
    qid: "CoI6",
    section: "Conflict of interest. (Entity/Enterprise based)",
    sectionWeight: 14,
    question:
      "Are you a beneficial owner of any controlling interest in any financial institution, partnerships, societies, or trust corporations or other body, organization or entity whether for business, benevolent or other purposes?",
    polarity: "Negative",
    questionWeight: 9,
    isKnockOut: false,
  },
  {
    qid: "T1",
    section: "Time Commitment",
    sectionWeight: 8,
    question:
      "Will you be actively engaged in the business of the Licensee to which this application relates and devote the major portion of your time thereto?",
    polarity: "Positive",
    questionWeight: 5,
    isKnockOut: false,
  },
  {
    qid: "T2",
    section: "Time Commitment",
    sectionWeight: 8,
    question:
      "If you are completing this form in the capacity of director or proposed director, please indicate whether you have or will have any executive responsibility for the management of the institution's business",
    polarity: "Positive",
    questionWeight: 3,
    isKnockOut: false,
  },
  {
    qid: "CoL1",
    section: "Conflict of interest. (Licensee based)",
    sectionWeight: 8,
    question: "Are any shares of the Licensee registered in your name?",
    polarity: "Negative",
    questionWeight: 5,
    isKnockOut: false,
  },
  {
    qid: "CoL3",
    section: "Conflict of interest. (Licensee based)",
    sectionWeight: 8,
    question:
      "Are any shares of the Licensee registered in the name of an immediate relative?",
    polarity: "Negative",
    questionWeight: 3,
    isKnockOut: false,
  },
  {
    qid: "CS4",
    section: "Collective Suitability",
    sectionWeight: 6,
    question:
      "Have you acquainted yourself with and do you understand the extent of the rights and powers, as well as your responsibilities and duties, as a director, officer or key employee or a proposed director, officer or key employee of the institution for which this questionnaire is being completed, as contained in the applicable law, regulations, and guidelines?",
    polarity: "Positive",
    questionWeight: 6,
    isKnockOut: false,
  },
];

export const QUESTION_BY_QID: Record<string, QuestionDef> = Object.fromEntries(
  QUESTIONS.map((q) => [q.qid, q])
);

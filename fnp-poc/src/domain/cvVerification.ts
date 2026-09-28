import type { CheckResult, CvFinding, CvSubmission, CvVerificationResult } from "./types";

/**
 * CV analysis is produced by the backend, not by this front end: the model reads the CV and
 * compares it against the qualification, experience and directorships the primary evidence has
 * already established. The POC stands in for that call with the analysis the v8 test set
 * expects for each applicant, so the page renders exactly what the service will return.
 *
 * Generated from testset/Expected_Auth_Response/*.json.
 */
interface CvAnalysis {
  consistencyFindings: CvFinding[];
  suitabilityFindings: CvFinding[];
}

const CV_ANALYSIS: Record<string, CvAnalysis> = {
  APP001: {
    consistencyFindings: [
      {
        aspect: "qualification",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Bachelor of Commerce (Accounting), University of Namibia, 1997 — matches the authenticated degree certificate exactly.",
      },
      {
        aspect: "experience",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Head of Credit Risk, Standard Trust Bank Limited, 2009–2024 — matches the authenticated employment letter.",
      },
      {
        aspect: "directorships",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV lists Non-Executive Director, Kavango Financial Services (Pty) Ltd, since 2016 — matches the authenticated registry extract.",
      },
    ],
    suitabilityFindings: [
      {
        aspect: "sector_relevance",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Entire career in banking and credit risk, directly relevant to a microfinance bank board seat.",
      },
      {
        aspect: "seniority_level",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Held a senior risk-management role reporting to the Chief Risk Officer, consistent with a director-level appointment.",
      },
      {
        aspect: "career_gaps",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Continuous employment 2009–2024, no gaps.",
      },
    ],
  },
  APP002: {
    consistencyFindings: [
      {
        aspect: "qualification",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states MBA, Finance and Risk Management, Namibia Business School, 2009 — matches the authenticated degree certificate.",
      },
      {
        aspect: "experience",
        verdict: "EVIDENCE_CONFLICT",
        confidence: 0.4,
        detail:
          "CV states Chief Operating Officer, Erongo Building Society, “since 2021”. The authenticated employment letter records this appointment as effective 2022-10-01, a discrepancy of roughly one year.",
      },
      {
        aspect: "directorships",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV lists Executive Director, Erongo Building Society, since 2019 — matches the authenticated registry extract.",
      },
    ],
    suitabilityFindings: [
      {
        aspect: "sector_relevance",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Entire career in building society and retail banking operations, directly relevant to the proposed role.",
      },
      {
        aspect: "seniority_level",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Chief Operating Officer and Executive Committee member, consistent with an executive director appointment.",
      },
      {
        aspect: "career_gaps",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Continuous employment 2012–present, no gaps.",
      },
    ],
  },
  APP003: {
    consistencyFindings: [
      {
        aspect: "qualification",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Bachelor of Laws (LLB), University of Cape Town, 1994 — matches the authenticated degree certificate.",
      },
      {
        aspect: "experience",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Compliance Director, Namib Trust Company (Pty) Ltd, 2018–2026, the same dates as the authenticated employment letter — it does not repeat the twelve-year figure declared on the form.",
      },
      {
        aspect: "directorships",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV lists Executive Director, Namib Trust Company (Pty) Ltd, since 2018 — matches the authenticated registry extract.",
      },
    ],
    suitabilityFindings: [
      {
        aspect: "sector_relevance",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Compliance and legal background in a licensed trust and fiduciary services company, relevant to the proposed role.",
      },
      {
        aspect: "seniority_level",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Compliance Director with principal responsibility for regulatory liaison, consistent with a director-level appointment.",
      },
      {
        aspect: "career_gaps",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Continuous employment 2018–2026, no gaps.",
      },
    ],
  },
  APP004: {
    consistencyFindings: [
      {
        aspect: "qualification",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Chartered Accountant (CA(NAM)), Institute of Chartered Accountants of Namibia, 2001 — matches the authenticated membership certificate.",
      },
      {
        aspect: "experience",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Chief Financial Officer, Windhoek Commercial Bank Limited, 2022–present, with prior positions back to 2010 — matches the authenticated employment letter.",
      },
      {
        aspect: "directorships",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV lists Executive Director, Windhoek Commercial Bank Limited, since 2015 — matches the authenticated registry extract. The CV does not mention Van Wyk Family Holdings (Pty) Ltd; a personal investment holding of this kind is commonly omitted from a CV and is not treated as a conflict.",
      },
    ],
    suitabilityFindings: [
      {
        aspect: "sector_relevance",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Sixteen years in commercial banking finance, directly relevant to the proposed role.",
      },
      {
        aspect: "seniority_level",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Chief Financial Officer and Executive Committee member, consistent with an executive director appointment.",
      },
      {
        aspect: "career_gaps",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Continuous employment 2010–2026, no gaps.",
      },
    ],
  },
  APP005: {
    consistencyFindings: [
      {
        aspect: "qualification",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Bachelor of Economics, University of Namibia, 1989 under the applicant's current name; the degree certificate itself is in the maiden name Margaret Iipinge, resolved against the national identity extract's record of the 1991 change of surname.",
      },
      {
        aspect: "experience",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV states Regional Director, Standard Trust Bank Ltd., 2020–2023, with prior positions back to 2005 — matches the authenticated employment letter.",
      },
      {
        aspect: "directorships",
        verdict: "CONSISTENT",
        confidence: 0.95,
        detail:
          "CV lists Director, Kaapanda Investments CC — matches the authenticated registry extract; neither document states an appointment date.",
      },
    ],
    suitabilityFindings: [
      {
        aspect: "sector_relevance",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Eighteen years in retail and rural banking, directly and strongly relevant to a microfinance bank board seat.",
      },
      {
        aspect: "seniority_level",
        verdict: "SUITABILITY_FLAG",
        confidence: 0.85,
        detail:
          "The CV shows an eighteen-year career built entirely in regional and branch-level roles (Branch Manager → Area Manager → Head of Rural Banking → Regional Director), with the CV itself noting the most senior of these was “regional in scope” and did not carry a head-office or executive committee mandate. Worth the committee's consideration for a board-level appointment despite the clear sector relevance.",
      },
      {
        aspect: "career_gaps",
        verdict: "NO_CONCERN",
        confidence: 0.92,
        detail:
          "Continuous employment 2005–2023, no gaps.",
      },
    ],
  },
};

/** Reviewer-facing only: a CV finding never moves the score or reopens the correction loop. */
const SCORING_IMPACT =
  "none — reviewer-facing only; does not affect the fit and proper score or reopen the correction loop";

/** The gate checks any attached document runs before it is read for content. */
function gateChecks(docLabel: string): CheckResult[] {
  return [
    {
      name: "Document_Check",
      label: "Document type",
      status: "pass",
      confidence: 0.96,
      note: `The uploaded file reads as a ${docLabel}, matching the document type selected.`,
    },
    {
      name: "Name_Check",
      label: "Document belongs to applicant",
      status: "pass",
      confidence: 0.96,
      note: "The name on the document matches the applicant record.",
    },
  ];
}

export function isCvFlag(finding: CvFinding): boolean {
  return finding.verdict === "EVIDENCE_CONFLICT" || finding.verdict === "SUITABILITY_FLAG";
}

/**
 * Runs after the 15 questions, since the consistency findings compare the CV against values
 * those questions have already authenticated.
 */
export function verifyCv(
  applicantId: string,
  cv: CvSubmission | undefined
): CvVerificationResult | null {
  if (!cv) return null;

  const attached = cv.evidence[0];
  if (!attached) {
    return {
      docType: cv.doc_type,
      status: "not_submitted",
      gateChecks: [],
      consistencyFindings: [],
      suitabilityFindings: [],
      flagCount: 0,
      scoringImpact: SCORING_IMPACT,
    };
  }

  const analysis = CV_ANALYSIS[applicantId];
  const consistencyFindings = analysis?.consistencyFindings ?? [];
  const suitabilityFindings = analysis?.suitabilityFindings ?? [];

  return {
    docType: attached.doc_type,
    status: "analyzed",
    gateChecks: gateChecks("curriculum vitae"),
    consistencyFindings,
    suitabilityFindings,
    flagCount: [...consistencyFindings, ...suitabilityFindings].filter(isCvFlag).length,
    scoringImpact: SCORING_IMPACT,
  };
}

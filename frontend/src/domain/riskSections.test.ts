import { describe, expect, it } from "vitest";
import { detailedQids, noRisk, riskShare, sectionTotals } from "./riskSections";
import type { ScoreResult, SectionScoreLine } from "./types";

const line = (qid: string, section: string, weight: number, risk: number, answer: "Yes" | "No" = "No"): SectionScoreLine => ({
  qid,
  section,
  question: `Question ${qid}?`,
  answer,
  polarity: "Positive",
  questionWeight: weight,
  riskFlag: risk > 0 ? 1 : 0,
  applicableWeight: weight,
  weightedRisk: risk,
  isKnockOut: false,
  knockOutTriggered: false,
});

const score = (lines: SectionScoreLine[]): ScoreResult => ({
  applicationId: "FNP-1",
  lines,
  totalApplicableWeight: lines.reduce((n, l) => n + l.applicableWeight, 0),
  totalWeightedRisk: lines.reduce((n, l) => n + l.weightedRisk, 0),
  normalisedRiskScore: 0,
  riskScore100: 0,
  band: "Low",
  knockOutTriggered: false,
  recommendation: "",
});

describe("where the risk comes from", () => {
  it("totals each section, riskiest first, then the heaviest", () => {
    const totals = sectionTotals(
      score([
        line("A1", "Basic Details", 2.5, 0),
        line("A4", "Basic Details", 1.5, 0),
        line("CoI2", "Conflict of interest", 7, 5),
        line("CoI6", "Conflict of interest", 7, 0),
        line("T1", "Time Commitment", 8, 5),
        line("Q1", "Qualifications", 18, 0),
      ])
    );
    expect(totals.map((t) => [t.section, t.risk, t.weight])).toEqual([
      ["Conflict of interest", 5, 14],
      ["Time Commitment", 5, 8],
      ["Qualifications", 0, 18],
      ["Basic Details", 0, 4],
    ]);
    // Each section keeps every one of its questions.
    expect(totals[0].lines.map((l) => l.qid)).toEqual(["CoI2", "CoI6"]);
  });

  it("shows in full the questions carrying risk and those with a concern", () => {
    const result = score([line("A1", "Basic Details", 2.5, 0), line("CoI2", "Conflict of interest", 7, 5), line("Q1", "Qualifications", 18, 0)]);
    expect([...detailedQids(result, ["Q1", "ZZ9"])].sort()).toEqual(["CoI2", "Q1"]);
    expect([...detailedQids(result, [])]).toEqual(["CoI2"]);
  });

  it("rounds a section's sums to the weights' two decimals", () => {
    const [total] = sectionTotals(score([line("A1", "Basic Details", 0.1, 0), line("A4", "Basic Details", 0.2, 0)]));
    expect(total.weight).toBe(0.3);
    expect(String(total.weight)).toBe("0.3");
  });

  it("fills a section's bar by its share, and never past the ends", () => {
    const [coi] = sectionTotals(score([line("CoI2", "Conflict of interest", 7, 5), line("CoI6", "Conflict of interest", 7, 0)]));
    expect(riskShare(coi)).toBeCloseTo(35.71, 1);
    expect(riskShare({ section: "Empty", weight: 0, risk: 0, lines: [] })).toBe(0);
    expect(riskShare({ section: "Over", weight: 4, risk: 9, lines: [] })).toBe(100);
  });
});

describe("noRisk", () => {
  it("is a section where nothing scored and no question is marked Risk", () => {
    const [risky, clear] = sectionTotals(
      score([line("A1", "Basic", 4, 1.5), line("A4", "Basic", 2, 0), line("Q1", "Experience", 6, 0), line("Q3", "Experience", 12, 0)])
    );
    expect(noRisk(risky)).toBe(false);
    expect(noRisk(clear)).toBe(true);
  });

  it("is not a section with a question marked Risk, even one adding nothing", () => {
    const [section] = sectionTotals(score([{ ...line("Q1", "Experience", 6, 0), riskFlag: 1 }]));
    expect(noRisk(section)).toBe(false);
  });
});

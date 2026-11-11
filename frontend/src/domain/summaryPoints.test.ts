import { describe, expect, it } from "vitest";
import { summaryPoints } from "./summaryPoints";

describe("summaryPoints", () => {
  it("splits a paragraph into its sentences", () => {
    const summary =
      "The applicant is a senior banking professional with 15 years 10 months of relevant experience, a clear police clearance (2026-07-28) and a self-declared record of no personal loan restructurings. The conditional determination is driven by her concurrent directorship of a deposit‑taking/microlending firm and the explicit non‑executive time commitment, which raise potential conflicts of interest and availability risks. Supervisory conditions and ongoing monitoring are therefore appropriate to mitigate these risks.";
    expect(summaryPoints(summary)).toEqual([
      "The applicant is a senior banking professional with 15 years 10 months of relevant experience, a clear police clearance (2026-07-28) and a self-declared record of no personal loan restructurings.",
      "The conditional determination is driven by her concurrent directorship of a deposit‑taking/microlending firm and the explicit non‑executive time commitment, which raise potential conflicts of interest and availability risks.",
      "Supervisory conditions and ongoing monitoring are therefore appropriate to mitigate these risks.",
    ]);
  });

  it("keeps the engine's own lines, without their dashes", () => {
    const summary =
      "Johanna N. Amutenya is proposed as a Non-Executive Director.\n- A reviewer allowed the submission to proceed for scoring.\n- Overall: elevated risk and referral for supervisory review is recommended.";
    expect(summaryPoints(summary)).toEqual([
      "Johanna N. Amutenya is proposed as a Non-Executive Director.",
      "A reviewer allowed the submission to proceed for scoring.",
      "Overall: elevated risk and referral for supervisory review is recommended.",
    ]);
  });

  it("does not break at initials, abbreviations or decimals", () => {
    expect(summaryPoints("Johanna N. Amutenya scored 34.5 of 100. Proof e.g. A passport is on file. Dr. Shivute signed it.")).toEqual([
      "Johanna N. Amutenya scored 34.5 of 100.",
      "Proof e.g. A passport is on file.",
      "Dr. Shivute signed it.",
    ]);
  });

  it("ends a sentence at a question or exclamation mark, and after a closing bracket or quote", () => {
    expect(summaryPoints('Is it verified? Not yet (pending). "Refer it." Then decide!')).toEqual([
      "Is it verified?",
      "Not yet (pending).",
      '"Refer it."',
      "Then decide!",
    ]);
  });

  it("takes other list markers and blank lines", () => {
    expect(summaryPoints("• First point.\r\n\r\n1. Second point.\n* Third point")).toEqual([
      "First point.",
      "Second point.",
      "Third point",
    ]);
  });

  it("keeps one sentence as one point, and gives none for an empty summary", () => {
    expect(summaryPoints("A single sentence without a full stop")).toEqual(["A single sentence without a full stop"]);
    expect(summaryPoints("")).toEqual([]);
    expect(summaryPoints("   \n  ")).toEqual([]);
    expect(summaryPoints(null)).toEqual([]);
  });
});

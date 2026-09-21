import type { Band } from "./types";

// Ported from fnp_scoring_model_15q.xlsx ("Bands" sheet). Lower bound, band, action.
const BAND_TABLE: { lowerBound: number; band: Band; action: string }[] = [
  { lowerBound: 0, band: "Low", action: "Recommend approval" },
  { lowerBound: 0.1, band: "Moderate", action: "Approve with conditions or monitoring" },
  { lowerBound: 0.25, band: "Elevated", action: "Refer for supervisory review" },
  { lowerBound: 0.45, band: "High", action: "Recommend rejection" },
];

export function bandFor(normalisedRiskScore: number): { band: Band; action: string } {
  let match = BAND_TABLE[0];
  for (const row of BAND_TABLE) {
    if (normalisedRiskScore >= row.lowerBound) match = row;
  }
  return { band: match.band, action: match.action };
}

export const KNOCK_OUT_ACTION = "Recommend rejection — refer for supervisory review";

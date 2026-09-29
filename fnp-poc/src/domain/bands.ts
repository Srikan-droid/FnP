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

/**
 * The same table as a set of zones on the 0-100 risk scale, for anything that has to draw the
 * bands rather than look one up.
 */
export const BAND_ZONES: { band: Band; from: number; to: number }[] = BAND_TABLE.map(
  (row, i) => ({
    band: row.band,
    from: row.lowerBound * 100,
    to: (BAND_TABLE[i + 1]?.lowerBound ?? 1) * 100,
  })
);

export const KNOCK_OUT_ACTION = "Recommend rejection — refer for supervisory review";

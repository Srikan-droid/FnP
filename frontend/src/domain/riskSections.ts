/**
 * Where a score's risk comes from: each section's weighted risk points against its maximum, with
 * the questions behind it. One calculation for the scoring page and the printed summary, so the
 * two always agree.
 */
import type { ScoreResult, SectionScoreLine } from "./types";

export interface SectionTotal {
  section: string;
  /** The most the section can contribute: its questions' weights. */
  weight: number;
  /** What it contributes: its questions' weighted risk. */
  risk: number;
  lines: SectionScoreLine[];
}

/** Each section's total, riskiest first (then the heaviest), its questions in score order. */
export function sectionTotals(scoreResult: ScoreResult): SectionTotal[] {
  const totals = new Map<string, SectionTotal>();
  for (const line of scoreResult.lines) {
    const entry = totals.get(line.section) ?? {
      section: line.section,
      weight: 0,
      risk: 0,
      lines: [],
    };
    entry.weight += line.questionWeight;
    entry.risk += line.weightedRisk;
    entry.lines.push(line);
    totals.set(line.section, entry);
  }
  // Weights have up to two decimals: the sums are rounded to them, so 0.1 + 0.2 reads 0.3.
  const hundredths = (n: number) => Math.round(n * 100) / 100;
  return [...totals.values()]
    .map((t) => ({ ...t, weight: hundredths(t.weight), risk: hundredths(t.risk) }))
    .sort((a, b) => b.risk - a.risk || b.weight - a.weight);
}

/**
 * Whether a section has no risk at all: nothing scored against it, and no question in it marked
 * Risk. It reads "No risk" in place of its score.
 */
export function noRisk(total: SectionTotal): boolean {
  return total.risk === 0 && total.lines.every((l) => l.riskFlag !== 1);
}

/**
 * The questions the printed breakdown shows in full (what each asks, and the AI engine's concerns
 * about it): those carrying risk, and any the engine wrote a concern about. A section holding one
 * prints open.
 */
export function detailedQids(scoreResult: ScoreResult, concernQids: string[]): Set<string> {
  const about = new Set(concernQids);
  return new Set(scoreResult.lines.filter((l) => l.riskFlag === 1 || about.has(l.qid)).map((l) => l.qid));
}

/** How full a section's bar is, from 0 to 100 (an empty section reads 0, not NaN). */
export function riskShare(total: SectionTotal): number {
  if (total.weight <= 0) return 0;
  return Math.min(100, Math.max(0, (total.risk / total.weight) * 100));
}

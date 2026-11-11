/**
 * The engine's executive summary as bullet points. It arrives either as one paragraph or as lines
 * starting "- " (the first often without one): lines are kept as the engine wrote them, and a
 * paragraph is split into its sentences.
 */

/** A list marker at the start of a line: "-", "*", "•", "–", or "1." / "1)". */
const MARKER = /^(?:[-*•–]|\d+[.)])\s+/;

// A full stop after one of these does not end the sentence ("Johanna N. Amutenya", "e.g. a
// passport"). Single letters cover initials and the parts of "e.g." and "i.e.".
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "no", "nos", "vs", "cf", "approx", "jr", "sr", "eg", "ie"]);

/** A sentence ends at ., ! or ? followed by a space and then a capital, a digit or an opening mark. */
const BREAK = /([.!?])["')\]]?\s+(?=["'([]?[A-Z0-9])/g;

function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const match of text.matchAll(BREAK)) {
    const end = match.index + match[0].trimEnd().length;
    const before = text.slice(start, match.index).split(/\s+/).pop() ?? "";
    const word = before.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (match[1] === "." && (word.length === 1 || ABBREVIATIONS.has(word))) continue;
    out.push(text.slice(start, end).trim());
    start = match.index + match[0].length;
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

export function summaryPoints(summary: string | null | undefined): string[] {
  const lines = (summary ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(MARKER, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  return lines.length === 1 ? sentences(lines[0]) : [];
}

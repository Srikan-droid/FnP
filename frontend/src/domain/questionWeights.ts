/**
 * The question configuration as the editor holds it, and the rules for its weights. Weights and
 * percentages are kept in hundredths, so 0.1 + 0.2 adds up to exactly 0.3.
 *
 * A section's weight is its share of 100; each question gets a percentage of its section's weight,
 * and its weight follows from that. The percentages in a section add up to 100%, and the section
 * weights to 100, so the question weights always add up to 100 too.
 *
 * A follow-up question (asked only on one answer of a Yes/No question in its section, one level
 * deep) is held in its section's list right after its parent, and nested under it only when the
 * edit is sent. It has no weight of its own (it counts under its parent's): it takes no share of
 * the section, and is sent with weight 0.
 */
import type { AnswerType, CatalogueQuestion, EvidenceRule, QuestionnaireVersion } from "../api/types";
import { DEFAULT_CHECKS, checkLabel } from "./checks";
import type { QuestionEdit, SectionEdit } from "../api/queries";
import { displaySection } from "./sectionLabels";
import type { Answer } from "./types";

export const ANSWERS: Answer[] = ["Yes", "No", "N/A"];
/** 100.00 in hundredths: the section weights' total, and each section's percentages' total. */
export const TOTAL = 10000;

/** The settings of a question that the reviewer edits (what "Edited" and "Undo changes" compare). */
export interface QuestionSettingsDraft {
  text: string;
  polarity: "Positive" | "Negative";
  answerType: AnswerType;
  /** Its share of the section's weight, as typed. */
  pct: string;
  allowedAnswers: Answer[];
  fileTypes: string[];
  maxFiles: 1 | 2;
  evidenceRequired: EvidenceRule;
  evidenceOptions: string[];
  /** The checks the AI engine runs on its documents, in the engine's form. */
  checks: string[];
  /** A follow-up question: its parent's answer that asks it (null for an ordinary question). */
  showWhen: Answer | null;
}

/** A question as the editor holds it. */
export interface EditQuestion extends QuestionSettingsDraft {
  key: string;
  /** A follow-up question: the key of the question it follows on from (null for an ordinary one). */
  parentKey: string | null;
  /** Its code; null for a question added in this edit (the server gives it one). */
  qid: string | null;
  /** Whether it names its own document types (one added here); otherwise the engine's list applies until others are chosen. */
  ownOptions: boolean;
  /** As published (null for one added now): its weight is kept exactly while nothing it depends on changes. */
  baseWeight: number | null;
  basePct: string;
  /** As published (null for one added now), to say what changing them does. */
  basePolarity: EditQuestion["polarity"] | null;
  baseAnswerType: AnswerType | null;
  /** Its settings as published, to tell an edited question and to undo the edit (null: added now). */
  original: QuestionSettingsDraft | null;
}

export interface EditSection {
  key: string;
  /** The name as shown and edited (the display name of a published section). */
  name: string;
  /** As published: the stored name, sent back unless it is renamed. */
  baseName: string | null;
  weight: string;
  baseWeight: number | null;
  baseCount: number;
  questions: EditQuestion[];
}

let nextKey = 1;
export const newKey = () => `k${nextKey++}`;

/** A number from 0 to 100 with at most two decimals, in hundredths; null otherwise. */
export function hundredths(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Math.round(Number(trimmed) * 100);
  return value <= TOTAL ? value : null;
}

/** Hundredths as the number shown and typed ("33.33", "6", "0.5"). */
export const show = (h: number) => String(h / 100);

/** A question's editable settings, on their own. */
export const settingsOf = (q: QuestionSettingsDraft): QuestionSettingsDraft => ({
  text: q.text,
  polarity: q.polarity,
  answerType: q.answerType,
  pct: q.pct,
  allowedAnswers: q.allowedAnswers,
  fileTypes: q.fileTypes,
  maxFiles: q.maxFiles,
  evidenceRequired: q.evidenceRequired,
  evidenceOptions: q.evidenceOptions,
  checks: q.checks,
  showWhen: q.showWhen,
});

export function fromVersion(version: QuestionnaireVersion): EditSection[] {
  // A follow-up is edited (and sent back nested) under its parent, so it is held in its parent's
  // section even if it was stored in another: it keeps its link rather than turning ordinary.
  const sectionOf = new Map(version.questions.map((q) => [q.qid, q.section]));
  const heldIn = (q: CatalogueQuestion) => (q.parentQid && sectionOf.get(q.parentQid)) || q.section;
  return version.sections.map((s) => {
    const questions = inFormOrder(version.questions.filter((q) => heldIn(q) === s.name));
    return {
      key: newKey(),
      name: displaySection(s.name),
      baseName: s.name,
      weight: String(s.weight),
      baseWeight: s.weight,
      baseCount: questions.filter((q) => !q.parentQid).length,
      questions: withWholePercentages(withParents(questions.map((q) => fromQuestion(q, s.weight)), questions)),
    };
  });
}

/** A section's questions with each one's follow-ups right after it. */
function inFormOrder(questions: CatalogueQuestion[]): CatalogueQuestion[] {
  const codes = new Set(questions.map((q) => q.qid));
  const top = questions.filter((q) => !q.parentQid || !codes.has(q.parentQid));
  return top.flatMap((q) => [q, ...questions.filter((f) => f.parentQid === q.qid && f !== q)]);
}

/** Points each follow-up at its parent's key in the editor. */
function withParents(edits: EditQuestion[], questions: CatalogueQuestion[]): EditQuestion[] {
  const keyOf = new Map(edits.map((e) => [e.qid, e.key]));
  return edits.map((e, i) => {
    const parentQid = questions[i].parentQid;
    const parentKey = parentQid ? (keyOf.get(parentQid) ?? null) : null;
    return parentKey ? { ...e, parentKey } : e;
  });
}

/** The questions that share the section's weight: all but the follow-ups. */
export const weighted = (questions: EditQuestion[]) => questions.filter((q) => !q.parentKey);

/** The follow-ups of a question, in order. */
export const followUpsOf = (section: EditSection, key: string) => section.questions.filter((q) => q.parentKey === key);

/** The question a follow-up follows on from (undefined for an ordinary question). */
export const parentOf = (section: EditSection, q: EditQuestion) =>
  q.parentKey ? section.questions.find((p) => p.key === q.parentKey) : undefined;

/** The longest question code the server stores. */
const QID_MAX_LENGTH = 10;

/**
 * The code each question added in this edit will be given when it is applied, by question key: the
 * server's rule, in the same order. A new question takes the next N code (N1, N2 ...), a new
 * follow-up its parent's code numbered on (A1-1, A1-2 ...), never a code used before, even by a
 * question since deleted (`used`). A follow-up code too long to store takes an N code instead.
 */
export function previewCodes(sections: EditSection[], used: string[]): Map<string, string> {
  const taken = new Set(used);
  for (const s of sections) for (const q of s.questions) if (q.qid) taken.add(q.qid);
  let n = Math.max(0, ...[...taken].map((c) => /^N(\d+)$/.exec(c)).filter(Boolean).map((m) => Number(m![1])));
  const nextQuestion = () => {
    n += 1;
    while (taken.has(`N${n}`)) n += 1;
    return `N${n}`;
  };
  const codes = new Map<string, string>();
  const codeOf = (q: EditQuestion) => q.qid ?? codes.get(q.key) ?? null;
  for (const s of sections) {
    for (const q of s.questions) {
      if (q.qid) continue;
      const parent = parentOf(s, q);
      const parentCode = parent ? codeOf(parent) : null;
      let code: string;
      if (parentCode) {
        const own = new RegExp(`^${parentCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
        const last = Math.max(0, ...[...taken].map((c) => own.exec(c)).filter(Boolean).map((m) => Number(m![1])));
        code = `${parentCode}-${last + 1}`;
        if (code.length > QID_MAX_LENGTH) code = nextQuestion();
      } else {
        code = nextQuestion();
      }
      taken.add(code);
      codes.set(q.key, code);
    }
  }
  return codes;
}

/** How the editor names a question: its code, or "the new question". */
export const nameOf = (q: EditQuestion) => q.qid ?? "the new question";

/**
 * Percentages rounded one by one need not add up to 100 (6, 6 and 6 of 18 read 33.33 each, 99.99
 * in all): the last question takes what is left, so a published section always reads 100%.
 */
function withWholePercentages(questions: EditQuestion[]): EditQuestion[] {
  const shared = weighted(questions);
  if (shared.length === 0) return questions;
  const others = shared.slice(0, -1).reduce((sum, q) => sum + (hundredths(q.pct) ?? 0), 0);
  const rest = TOTAL - others;
  if (rest < 0) return questions;
  const last = shared[shared.length - 1];
  const fixed = {
    ...last,
    pct: show(rest),
    basePct: show(rest),
    original: last.original && { ...last.original, pct: show(rest) },
  };
  return questions.map((q) => (q === last ? fixed : q));
}

function fromQuestion(q: CatalogueQuestion, sectionWeight: number): EditQuestion {
  const pct = sectionWeight > 0 && !q.parentQid ? String(Math.round((q.weight / sectionWeight) * 10000) / 100) : "0";
  const question: EditQuestion = {
    key: newKey(),
    qid: q.qid,
    text: q.text,
    polarity: q.polarity,
    answerType: q.answerType ?? "choice",
    pct,
    allowedAnswers: q.allowedAnswers,
    fileTypes: q.fileTypes,
    maxFiles: q.maxFiles,
    evidenceRequired: q.evidenceRequired,
    evidenceOptions: q.evidenceOptions ?? [],
    checks: q.checks ?? [],
    showWhen: q.parentQid ? (q.showWhen ?? null) : null,
    parentKey: null,
    // A question added here names its document types (the engine has no list of its own for it).
    ownOptions: q.addedHere ?? false,
    baseWeight: q.weight,
    basePct: pct,
    basePolarity: q.polarity,
    baseAnswerType: q.answerType ?? "choice",
    original: null,
  };
  question.original = settingsOf(question);
  return question;
}

/** A new question; a new follow-up when given its parent and the answer that asks it. */
export function blankQuestion(pct = "0", follows?: { parentKey: string; showWhen: Answer }): EditQuestion {
  return {
    key: newKey(),
    parentKey: follows?.parentKey ?? null,
    showWhen: follows?.showWhen ?? null,
    qid: null,
    text: "",
    polarity: "Positive",
    answerType: "choice",
    pct,
    allowedAnswers: ["Yes", "No"],
    fileTypes: ["pdf"],
    maxFiles: 1,
    evidenceRequired: "if_yes",
    evidenceOptions: [],
    checks: [...DEFAULT_CHECKS],
    ownOptions: true,
    baseWeight: null,
    basePct: pct,
    basePolarity: null,
    baseAnswerType: null,
    original: null,
  };
}

/**
 * Whether a published question's settings differ from what was published. Its share of the section
 * is not counted: the row shows it, and the section's status says whether the shares add up.
 */
export function isEdited(q: EditQuestion): boolean {
  if (!q.original) return false;
  const now = settingsOf(q);
  const was = q.original;
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    now.text.trim() !== was.text.trim() ||
    now.polarity !== was.polarity ||
    now.answerType !== was.answerType ||
    now.maxFiles !== was.maxFiles ||
    now.evidenceRequired !== was.evidenceRequired ||
    now.showWhen !== was.showWhen ||
    !sameSet(now.allowedAnswers, was.allowedAnswers) ||
    !sameSet(now.fileTypes, was.fileTypes) ||
    !sameSet(now.evidenceOptions, was.evidenceOptions) ||
    !sameSet(now.checks, was.checks)
  );
}

/**
 * The question's settings put back as published (its place in the editor kept). Its share of the
 * section stays as it is now, so the section's percentages still add up.
 */
export function undoEdits(q: EditQuestion): EditQuestion {
  return q.original ? { ...q, ...q.original, pct: q.pct } : q;
}

/**
 * Each question's weight, in hundredths, from the section's weight and the percentages (in the
 * order of the section's questions; 0 for a follow-up, which has none of its own). While nothing
 * they depend on has changed, the published weights stand as they are. Null while a number is not
 * valid.
 */
export function weightsOf(section: EditSection): number[] | null {
  const shared = weighted(section.questions);
  const sw = hundredths(section.weight);
  const pcts = shared.map((q) => hundredths(q.pct));
  if (sw === null || pcts.some((p) => p === null)) return null;
  const untouched =
    section.baseWeight !== null &&
    sw === Math.round(section.baseWeight * 100) &&
    shared.length === section.baseCount &&
    shared.every((q) => q.baseWeight !== null && q.pct === q.basePct);
  const weights = untouched
    ? shared.map((q) => Math.round((q.baseWeight ?? 0) * 100))
    : pctTotal(section) !== TOTAL
      ? pcts.map((p) => Math.round((sw * (p ?? 0)) / TOTAL))
      : shareOut(sw, pcts.map((p) => p ?? 0));
  const byKey = new Map(shared.map((q, i) => [q.key, weights[i]]));
  return section.questions.map((q) => byKey.get(q.key) ?? 0);
}

/**
 * A total shared out by percentages exactly (largest remainder): each gets its share rounded down,
 * and the hundredths left go to those with the biggest fractions, so the shares add up to the
 * total and none is ever below 0.
 */
function shareOut(total: number, pcts: number[]): number[] {
  const exact = pcts.map((p) => (total * p) / TOTAL);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

export function pctTotal(section: EditSection): number | null {
  const pcts = weighted(section.questions).map((q) => hundredths(q.pct));
  return pcts.some((p) => p === null) ? null : pcts.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/** 100 split evenly into `count` parts, in hundredths: the last takes what is left (33.33, 33.33, 33.34). */
export function evenSplit(count: number): number[] {
  if (count <= 0) return [];
  const each = Math.floor(TOTAL / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? TOTAL - each * (count - 1) : each));
}

/** What is left to share (positive), or how much over (negative), in hundredths; null if a value is not valid. */
export function remainder(values: string[]): number | null {
  const parsed = values.map(hundredths);
  if (parsed.some((v) => v === null)) return null;
  return TOTAL - parsed.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/** A plain account of how much of 100 is shared out. */
export function shareStatus(left: number | null, unit: string): { tone: "ok" | "short" | "over" | "invalid"; text: string } {
  if (left === null) return { tone: "invalid", text: "Enter each value as a number from 0 to 100, with at most two decimals" };
  if (left === 0) return { tone: "ok", text: "All assigned" };
  if (left > 0) return { tone: "short", text: `${show(left)}${unit} left to assign` };
  return { tone: "over", text: `${show(-left)}${unit} over — reduce one by ${show(-left)}${unit}` };
}

/**
 * What is wrong with a question's settings, if anything. Given its section, a follow-up is checked
 * against its parent, and a parent against its follow-ups.
 */
export function questionProblem(q: EditQuestion, section?: EditSection): string | null {
  if (!q.text.trim()) return "Enter the question.";
  if (section) {
    const parent = parentOf(section, q);
    if (parent && q.showWhen && (parent.answerType !== "choice" || !parent.allowedAnswers.includes(q.showWhen))) {
      return `It is asked when ${nameOf(parent)} is answered ${q.showWhen}, which ${nameOf(parent)} no longer offers. Choose another answer for it, or offer ${q.showWhen} again.`;
    }
    const followUps = followUpsOf(section, q.key);
    if (followUps.length > 0 && q.answerType !== "choice") {
      return "A question answered in words cannot have follow-up questions: make it a Yes / No question, or delete its follow-ups.";
    }
    const stranded = followUps.find((f) => f.showWhen && !q.allowedAnswers.includes(f.showWhen));
    if (stranded) {
      return `Its follow-up ${nameOf(stranded)} is asked on ${stranded.showWhen}: keep ${stranded.showWhen} among the answers offered, or change the follow-up.`;
    }
  }
  if (!q.parentKey && hundredths(q.pct) === null) return "Enter a percentage from 0 to 100, with at most two decimals.";
  if (q.answerType === "choice" && q.allowedAnswers.length === 0) return "Choose at least one answer option.";
  if (q.evidenceRequired !== "never" && q.fileTypes.length === 0) return "Choose at least one accepted file type.";
  if (q.ownOptions && q.evidenceRequired !== "never" && q.evidenceOptions.length === 0) {
    return "Choose the document types this question takes.";
  }
  return null;
}

const RULES: Record<EvidenceRule, string> = {
  always: "Document always",
  if_yes: "Document if Yes",
  never: "No document",
};

/** A question's settings in a line: "Negative · Yes / No · Document if Yes · PDF, XLSX · up to 2 files". */
export function summaryLine(q: QuestionSettingsDraft): string {
  const parts: string[] = [q.polarity];
  parts.push(q.answerType === "text" ? "Text answer" : ANSWERS.filter((a) => q.allowedAnswers.includes(a)).join(" / "));
  parts.push(RULES[q.evidenceRequired]);
  if (q.evidenceRequired !== "never") {
    parts.push(q.fileTypes.map((t) => t.toUpperCase()).join(", "));
    parts.push(q.maxFiles === 2 ? "up to 2 files" : "1 file");
    if (q.checks.length > 0) parts.push(q.checks.length === 1 ? "1 check" : `${q.checks.length} checks`);
  }
  return parts.join(" · ");
}

/** The questionnaire in the shape the server takes it: each question's follow-ups nested under it. */
export function toBody(sections: EditSection[]): SectionEdit[] {
  return sections.map((s) => {
    const weights = weightsOf(s) ?? s.questions.map(() => 0);
    const takesDocs = (q: EditQuestion) => q.evidenceRequired !== "never";
    const edit = (q: EditQuestion): QuestionEdit => ({
      qid: q.qid,
      text: q.text.trim(),
      polarity: q.polarity,
      answerType: q.answerType,
      weight: weights[s.questions.indexOf(q)] / 100,
      allowedAnswers: q.answerType === "text" ? [] : ANSWERS.filter((a) => q.allowedAnswers.includes(a)),
      fileTypes: takesDocs(q) ? q.fileTypes : [],
      maxFiles: takesDocs(q) ? q.maxFiles : 1,
      evidenceRequired: q.evidenceRequired,
      // None chosen for one of the engine's questions: it takes the engine's own list.
      evidenceOptions: takesDocs(q) ? q.evidenceOptions : [],
      // Checks are run on its documents: none for a question that takes none.
      checks: takesDocs(q) ? q.checks : [],
    });
    return {
      name: s.baseName !== null && s.name.trim() === displaySection(s.baseName) ? s.baseName : s.name.trim(),
      weight: (hundredths(s.weight) ?? 0) / 100,
      questions: s.questions
        .filter((q) => !q.parentKey)
        .map((q) => ({
          ...edit(q),
          followUps: followUpsOf(s, q.key).map((f) => ({ ...edit(f), showWhen: f.showWhen ?? "Yes" })),
        })),
    };
  });
}

/** Every question an edit sends, follow-ups included, each with the code of the question it follows on from. */
function flatQuestions(section: SectionEdit): (QuestionEdit & { parent: string | null; showWhen: Answer | null })[] {
  return section.questions.flatMap((q) => [
    { ...q, parent: null, showWhen: null },
    ...(q.followUps ?? []).map((f) => ({ ...f, parent: q.qid ?? "the new question" })),
  ]);
}

// ---- What an edit changes, for the summary shown before applying it ---------------------------

/** What a change reaches on the applications not yet submitted (read when about to apply). */
export interface DraftUse {
  /** How many forms not yet submitted there are. */
  drafts: number;
  /** For each question, how many of them have an answer saved for it. */
  answered: Record<string, number>;
  /** For each question, how many of them have a document attached to it. */
  documents: Record<string, number>;
}

const apps = (n: number) => `${n} unsubmitted application${n === 1 ? "" : "s"}`;

/**
 * What applying removes for a question from the applications not yet submitted, as the end of its
 * line: its saved answers, and its documents (all of them, or those not backed by a Yes when it now
 * takes one only for a Yes). Empty when it removes nothing of that kind.
 */
function loss(use: DraftUse | null, qid: string, answers: boolean, documents: "all" | "unless-yes" | "none"): string {
  if (!answers && documents === "none") return "";
  if (!use) {
    const what = [
      answers && "saved answers",
      documents === "all" && "attached documents",
      documents === "unless-yes" && "documents attached where the answer is not Yes",
    ].filter(Boolean);
    return ` — ${what.join(" and ")} on unsubmitted applications are removed`;
  }
  const a = use.answered[qid] ?? 0;
  const d = use.documents[qid] ?? 0;
  const parts: string[] = [];
  if (answers && a > 0) parts.push(`saved answers on ${apps(a)}`);
  if (documents === "all" && d > 0) parts.push(`documents attached on ${apps(d)}`);
  if (documents === "unless-yes" && d > 0) parts.push(`documents attached on up to ${apps(d)} (where the answer is not Yes)`);
  return parts.length > 0
    ? ` — ${parts.join(" and ")} are removed`
    : " — no unsubmitted application has anything saved for it";
}

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text);

/**
 * The changes an edit makes to the questionnaire in force, in plain lines, most telling first:
 * sections added, deleted, renamed or reweighted, then each question added, deleted or changed.
 */
export function changeSummary(published: QuestionnaireVersion, edited: SectionEdit[], use: DraftUse | null): string[] {
  const lines: string[] = [];
  const before = new Map(published.sections.map((s) => [s.name, s]));
  const after = new Map(edited.map((s) => [s.name, s]));
  const beforeQ = new Map(published.questions.map((q) => [q.qid, q]));
  const afterQ = new Map(edited.flatMap((s) => flatQuestions(s).filter((q) => q.qid).map((q) => [q.qid as string, { ...q, section: s.name }])));

  // Sections: matched by name, or by holding the same questions when renamed.
  const sectionOf = (qid: string) => beforeQ.get(qid)?.section;
  const renamedFrom = new Map<string, string>();
  for (const s of edited) {
    if (before.has(s.name)) continue;
    const from = flatQuestions(s).map((q) => (q.qid ? sectionOf(q.qid) : undefined)).find((n) => n && !after.has(n));
    if (from) renamedFrom.set(s.name, from);
  }
  const renamedTo = new Set(renamedFrom.values());
  for (const s of edited) {
    const fromName = before.has(s.name) ? s.name : renamedFrom.get(s.name);
    const was = fromName ? before.get(fromName) : undefined;
    if (!was) {
      lines.push(`Section "${displaySection(s.name)}" added, weight ${s.weight} of 100`);
      continue;
    }
    if (fromName !== s.name) lines.push(`Section "${displaySection(fromName as string)}" renamed "${displaySection(s.name)}"`);
    if (was.weight !== s.weight) lines.push(`${displaySection(s.name)}: weight ${was.weight} → ${s.weight} of 100`);
  }
  for (const s of published.sections) {
    if (after.has(s.name) || renamedTo.has(s.name)) continue;
    const held = published.questions
      .filter((q) => q.section === s.name)
      .map((q) => {
        const a = use?.answered[q.qid] ?? 0;
        const d = use?.documents[q.qid] ?? 0;
        const what = [a > 0 && `${a} answer${a === 1 ? "" : "s"}`, d > 0 && `${d} with documents`].filter(Boolean);
        return what.length > 0 ? `${q.qid}: ${what.join(", ")}` : null;
      })
      .filter(Boolean);
    const impact = !use
      ? " — saved answers and documents for them on unsubmitted applications are removed"
      : held.length === 0
        ? " — no unsubmitted application has anything saved for them"
        : ` — removed from unsubmitted applications (${held.join("; ")})`;
    lines.push(`Section "${displaySection(s.name)}" deleted, with its questions${impact}`);
  }

  // Questions.
  for (const s of edited) {
    for (const q of flatQuestions(s)) {
      if (q.qid) continue;
      const text = short(q.text || "(no text yet)");
      lines.push(
        q.parent
          ? `New follow-up question in ${displaySection(s.name)} (to ${q.parent}, asked when it is ${q.showWhen}): "${text}"`
          : `New question in ${displaySection(s.name)}: "${text}", ${q.weight} of 100`
      );
    }
  }
  for (const [qid, was] of beforeQ) {
    const now = afterQ.get(qid);
    if (!now) {
      // Deleted with its section: already said above.
      const sectionGone = !after.has(was.section) && !renamedTo.has(was.section);
      if (!sectionGone) lines.push(`${qid} deleted${loss(use, qid, true, "all")}`);
      continue;
    }
    const changes: string[] = [];
    if (now.parent !== (was.parentQid ?? null) || now.showWhen !== (was.showWhen ?? null)) {
      changes.push(now.parent ? `now a follow-up to ${now.parent}, asked when it is ${now.showWhen}` : "now asked of everyone");
    }
    if (now.text.trim() !== was.text.trim()) changes.push("question text edited");
    if (now.polarity !== was.polarity) changes.push(`polarity ${was.polarity} → ${now.polarity}`);
    const retyped = now.answerType !== (was.answerType ?? "choice");
    if (retyped) {
      // Its saved answers no longer fit; a document stays only where it is still always taken.
      const to = now.answerType === "text" ? "a Text question" : "a Yes / No question";
      changes.push(`now ${to}${loss(use, qid, true, now.evidenceRequired === "always" ? "none" : "all")}`);
    } else if (now.answerType === "choice" && now.allowedAnswers.join() !== ANSWERS.filter((a) => was.allowedAnswers.includes(a)).join()) {
      changes.push(`answer options ${now.allowedAnswers.join(" / ")}`);
    }
    if (now.evidenceRequired !== was.evidenceRequired) {
      // Documents a question no longer asks for come off the applications (said with the type change
      // above when it was retyped).
      const documents = retyped || now.evidenceRequired === "always" ? "none" : now.evidenceRequired === "never" ? "all" : "unless-yes";
      changes.push(`${RULES[now.evidenceRequired].toLowerCase()}${loss(use, qid, false, documents)}`);
    }
    if (now.evidenceRequired !== "never") {
      if ([...now.fileTypes].sort().join() !== [...was.fileTypes].sort().join()) changes.push(`file types ${now.fileTypes.map((t) => t.toUpperCase()).join(", ")}`);
      if (now.maxFiles !== was.maxFiles) changes.push(now.maxFiles === 2 ? "up to 2 files" : "1 file");
      if ([...now.evidenceOptions].sort().join() !== [...(was.evidenceOptions ?? [])].sort().join()) changes.push("document types changed");
      const wasChecks = was.checks ?? [];
      const added = now.checks.filter((c) => !wasChecks.includes(c));
      const dropped = wasChecks.filter((c) => !now.checks.includes(c));
      if (added.length > 0) changes.push(`checks added: ${added.map(checkLabel).join(", ")}`);
      if (dropped.length > 0) changes.push(`checks removed: ${dropped.map(checkLabel).join(", ")}`);
    }
    if (now.weight !== was.weight) changes.push(`weight ${was.weight} → ${now.weight} of 100`);
    if (changes.length > 0) lines.push(`${qid}: ${changes.join("; ")}`);
  }
  return lines;
}

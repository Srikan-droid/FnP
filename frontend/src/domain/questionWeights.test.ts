import { describe, expect, it } from "vitest";
import {
  blankQuestion,
  changeSummary,
  evenSplit,
  fromVersion,
  isEdited,
  pctTotal,
  previewCodes,
  questionProblem,
  remainder,
  shareStatus,
  summaryLine,
  toBody,
  undoEdits,
  weightsOf,
} from "./questionWeights";
import type { CatalogueQuestion, QuestionnaireVersion } from "../api/types";

const question = (qid: string, section: string, weight: number, extra: Partial<CatalogueQuestion> = {}): CatalogueQuestion => ({
  qid,
  section,
  text: `Question ${qid}?`,
  polarity: "Positive",
  weight,
  isKnockout: false,
  evidenceRequired: "always",
  answerType: "choice",
  evidenceOptions: [],
  allowsNa: false,
  acceptsSupporting: false,
  checks: [],
  allowedAnswers: ["Yes", "No"],
  fileTypes: ["pdf"],
  maxFiles: 1,
  ...extra,
});

const version: QuestionnaireVersion = {
  version: "v1",
  sections: [
    { name: "Basic Details", weight: 82 },
    { name: "Qualifications", weight: 18 },
  ],
  questions: [
    question("A1", "Basic Details", 82),
    question("Q1", "Qualifications", 6),
    question("Q2", "Qualifications", 6),
    question("Q3", "Qualifications", 6),
  ],
} as QuestionnaireVersion;

describe("sharing out 100", () => {
  it("splits evenly, the last taking what is left", () => {
    expect(evenSplit(3)).toEqual([3333, 3333, 3334]);
    expect(evenSplit(4)).toEqual([2500, 2500, 2500, 2500]);
    expect(evenSplit(0)).toEqual([]);
  });

  it("says what is left or over in words", () => {
    expect(shareStatus(remainder(["60", "40"]), "%")).toEqual({ tone: "ok", text: "All assigned" });
    expect(shareStatus(remainder(["60", "20"]), "%").text).toBe("20% left to assign");
    expect(shareStatus(remainder(["60", "45"]), "%").text).toBe("5% over — reduce one by 5%");
    expect(shareStatus(remainder(["60", "abc"]), "%").tone).toBe("invalid");
  });

  it("reopens a three-way split at 100% with its weights exact", () => {
    const [, quals] = fromVersion(version);
    expect(quals.questions.map((q) => q.pct)).toEqual(["33.33", "33.33", "33.34"]);
    expect(weightsOf(quals)).toEqual([600, 600, 600]);
  });

  it("never gives a weight below 0, and the weights add up to the section's", () => {
    const [, quals] = fromVersion(version);
    const uneven = {
      ...quals,
      weight: "10",
      questions: [
        { ...quals.questions[0], pct: "0.05" },
        { ...quals.questions[1], pct: "0.05" },
        { ...quals.questions[2], pct: "99.9" },
      ],
    };
    const weights = weightsOf(uneven) ?? [];
    expect(weights.every((w) => w >= 0)).toBe(true);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe("a question's settings", () => {
  it("reads as one line", () => {
    const [basic] = fromVersion(version);
    expect(summaryLine(basic.questions[0])).toBe("Positive · Yes / No · Document always · PDF · 1 file");
    expect(summaryLine({ ...basic.questions[0], checks: ["Document_Check", "Age_Check"] })).toBe(
      "Positive · Yes / No · Document always · PDF · 1 file · 2 checks"
    );
    expect(summaryLine({ ...basic.questions[0], answerType: "text", evidenceRequired: "never" })).toBe(
      "Positive · Text answer · No document"
    );
  });

  it("tells an edited question, and undoes the edit", () => {
    const [basic] = fromVersion(version);
    const q = basic.questions[0];
    expect(isEdited(q)).toBe(false);
    const edited = { ...q, polarity: "Negative" as const, text: "Changed?" };
    expect(isEdited(edited)).toBe(true);
    const undone = undoEdits(edited);
    expect(isEdited(undone)).toBe(false);
    expect(undone.key).toBe(q.key);
  });

  it("keeps the question's share when undoing, so the section still adds up", () => {
    const [, quals] = fromVersion(version);
    // Shared out anew (Split equally), then one question's text edited and undone.
    const q = { ...quals.questions[0], pct: "50", text: "Changed?" };
    expect(isEdited({ ...quals.questions[0], pct: "50" })).toBe(false); // a share alone is not an edit
    const undone = undoEdits(q);
    expect(undone.pct).toBe("50");
    expect(undone.text).toBe(quals.questions[0].text);
  });
});

describe("the change summary", () => {
  const use = (answered: Record<string, number>, documents: Record<string, number> = {}) => ({ drafts: 4, answered, documents });

  it("is empty when nothing changed", () => {
    expect(changeSummary(version, toBody(fromVersion(version)), null)).toEqual([]);
  });

  it("names each change, with the answers and documents it removes", () => {
    const sections = fromVersion(version);
    sections[0].questions[0] = { ...sections[0].questions[0], polarity: "Negative", answerType: "text", evidenceRequired: "never" };
    sections[1].questions.pop(); // Q3 deleted
    sections[1].questions[1] = { ...sections[1].questions[1], pct: "66.67" };
    const lines = changeSummary(version, toBody(sections), use({ A1: 2, Q3: 1 }, { A1: 1 }));
    expect(lines).toContain(
      "A1: polarity Positive → Negative; now a Text question — saved answers on 2 unsubmitted applications and documents attached on 1 unsubmitted application are removed; no document"
    );
    expect(lines).toContain("Q3 deleted — saved answers on 1 unsubmitted application are removed");
    expect(lines.some((l) => l.startsWith("Q2: weight 6 → 12"))).toBe(true);
  });

  it("says plainly when nothing saved is affected", () => {
    const q2gone = fromVersion(version);
    q2gone[1].questions.splice(1, 1);
    expect(changeSummary(version, toBody(q2gone), use({}))).toContain("Q2 deleted — no unsubmitted application has anything saved for it");
    const retyped = fromVersion(version);
    retyped[0].questions[0] = { ...retyped[0].questions[0], answerType: "text" };
    expect(changeSummary(version, toBody(retyped), use({}))).toContain(
      "A1: now a Text question — no unsubmitted application has anything saved for it"
    );
  });

  it("names the documents a question no longer asks for", () => {
    const never = fromVersion(version);
    never[0].questions[0] = { ...never[0].questions[0], evidenceRequired: "never" };
    expect(changeSummary(version, toBody(never), use({}, { A1: 3 }))).toContain(
      "A1: no document — documents attached on 3 unsubmitted applications are removed"
    );
    const ifYes = fromVersion(version);
    ifYes[0].questions[0] = { ...ifYes[0].questions[0], evidenceRequired: "if_yes" };
    expect(changeSummary(version, toBody(ifYes), use({}, { A1: 3 }))).toContain(
      "A1: document if yes — documents attached on up to 3 unsubmitted applications (where the answer is not Yes) are removed"
    );
    // Without the counts, it still says what kind of thing is removed.
    expect(changeSummary(version, toBody(never), null)).toContain(
      "A1: no document — attached documents on unsubmitted applications are removed"
    );
  });

  it("names a section added, deleted or renamed", () => {
    const sections = fromVersion(version);
    sections[1] = { ...sections[1], name: "Qualifications and experience" };
    const body = toBody(sections);
    body.push({ name: "Foreign Directorships", weight: 0, questions: [] });
    const lines = changeSummary(version, body, null);
    expect(lines).toContain('Section "Qualifications" renamed "Qualifications and experience"');
    expect(lines).toContain('Section "Foreign Directorships" added, weight 0 of 100');
    const withoutBasic = toBody(fromVersion(version)).slice(1);
    expect(changeSummary(version, withoutBasic, null)).toContain(
      'Section "Basic Details" deleted, with its questions — saved answers and documents for them on unsubmitted applications are removed'
    );
    expect(changeSummary(version, withoutBasic, use({ A1: 2 }, { A1: 1 }))).toContain(
      'Section "Basic Details" deleted, with its questions — removed from unsubmitted applications (A1: 2 answers, 1 with documents)'
    );
    expect(changeSummary(version, withoutBasic, use({}))[0]).toMatch(/no unsubmitted application has anything saved for them/);
  });
});

describe("a question's checks", () => {
  it("are part of what is edited, and of what is sent", () => {
    const sections = fromVersion(version);
    const q = sections[0].questions[0];
    expect(isEdited({ ...q, checks: ["Document_Check", "Licence_Validity_Check"] })).toBe(true);
    sections[0].questions[0] = { ...q, checks: ["Document_Check"] };
    expect(toBody(sections)[0].questions[0].checks).toEqual(["Document_Check"]);
    // None for a question that takes no documents.
    sections[0].questions[0] = { ...q, checks: ["Document_Check"], evidenceRequired: "never" };
    expect(toBody(sections)[0].questions[0].checks).toEqual([]);
  });

  it("start with the document and name checks on a new question", () => {
    expect(blankQuestion().checks).toEqual(["Document_Check", "Name_Check"]);
  });

  it("say what is added and removed before applying", () => {
    const sections = fromVersion(version);
    sections[0].questions[0] = { ...sections[0].questions[0], checks: ["Licence_Validity_Check"] };
    const withChecks = { ...version, questions: version.questions.map((q, i) => (i === 0 ? { ...q, checks: ["Age_Check"] } : q)) };
    expect(changeSummary(withChecks, toBody(sections), null)).toContain(
      "A1: checks added: Licence validity check; checks removed: Age check"
    );
  });
});

describe("check names", () => {
  it("take the engine's form, and read in words", async () => {
    const { checkName, checkLabel } = await import("./checks");
    expect(checkName("licence validity")).toBe("Licence_Validity_Check");
    expect(checkName("  Licence  validity CHECK ")).toBe("Licence_Validity_Check");
    expect(checkName("Age_Check")).toBe("Age_Check");
    expect(checkName(" -- ")).toBeNull();
    expect(checkLabel("ID_Number_Check")).toBe("ID number check");
  });
});

describe("follow-up questions", () => {
  const withFollowUp: QuestionnaireVersion = {
    ...version,
    questions: [
      question("A1", "Basic Details", 82),
      question("Q1", "Qualifications", 9),
      question("Q2", "Qualifications", 9),
      // A follow-up has no weight of its own.
      question("Q3", "Qualifications", 0, { parentQid: "Q1", showWhen: "Yes" }),
    ],
  } as QuestionnaireVersion;

  it("sit right after their parent in the editor, and go nested under it", () => {
    const sections = fromVersion(withFollowUp);
    const quals = sections[1];
    expect(quals.questions.map((q) => q.qid)).toEqual(["Q1", "Q3", "Q2"]);
    expect(quals.questions[1].parentKey).toBe(quals.questions[0].key);
    expect(quals.questions[1].showWhen).toBe("Yes");

    const body = toBody(sections)[1];
    expect(body.questions.map((q) => q.qid)).toEqual(["Q1", "Q2"]);
    expect(body.questions[0].followUps.map((f) => [f.qid, f.showWhen, f.weight])).toEqual([["Q3", "Yes", 0]]);
    // The section's weight is shared by its own questions only.
    expect(body.questions.map((q) => q.weight)).toEqual([9, 9]);
    expect(quals.questions.map((q) => q.pct)).toEqual(["50", "0", "50"]);
    expect(pctTotal(quals)).toBe(10000);
    expect(body.questions[1].followUps).toEqual([]);
    // Published as it was: nothing to summarise.
    expect(changeSummary(withFollowUp, toBody(sections), null)).toEqual([]);
  });

  it("stay follow-ups when stored in another section than their parent", () => {
    const apart = {
      ...version,
      questions: [
        question("A1", "Basic Details", 82),
        question("Q1", "Qualifications", 9),
        question("Q2", "Qualifications", 9),
        question("Q3", "Qualifications", 0, { parentQid: "A1", showWhen: "Yes" }),
      ],
    } as QuestionnaireVersion;
    const sections = fromVersion(apart);
    expect(sections[0].questions.map((q) => [q.qid, q.parentKey === sections[0].questions[0].key])).toEqual([
      ["A1", false],
      ["Q3", true],
    ]);
    expect(sections[1].questions.map((q) => q.qid)).toEqual(["Q1", "Q2"]);
    const body = toBody(sections);
    expect(body[0].questions[0].followUps.map((f) => [f.qid, f.showWhen, f.weight])).toEqual([["Q3", "Yes", 0]]);
    expect(body[1].questions.map((q) => q.weight)).toEqual([9, 9]);
  });

  it("show from the start the code applying will give them", () => {
    const sections = fromVersion(version);
    const [basic, quals] = sections;
    const a1 = basic.questions[0];
    // Two follow-ups under A1, a new question in Qualifications, and a follow-up under that.
    const f1 = blankQuestion("0", { parentKey: a1.key, showWhen: "Yes" });
    const f2 = blankQuestion("0", { parentKey: a1.key, showWhen: "No" });
    basic.questions.push(f1, f2);
    const added = blankQuestion("0");
    const addedFollowUp = blankQuestion("0", { parentKey: added.key, showWhen: "Yes" });
    quals.questions.push(added, addedFollowUp);
    // A1-1 and N4 were used before (since deleted): never given again.
    const codes = previewCodes(sections, ["A1", "Q1", "Q2", "Q3", "A1-1", "N4"]);
    expect([f1, f2, added, addedFollowUp].map((q) => codes.get(q.key))).toEqual(["A1-2", "A1-3", "N5", "N5-1"]);
    // Published questions keep their own code.
    expect(codes.has(a1.key)).toBe(false);
  });

  it("are checked against their parent", () => {
    const quals = fromVersion(withFollowUp)[1];
    const [q1, q3] = quals.questions;
    expect(questionProblem(q3, quals)).toBeNull();
    const noYes = { ...quals, questions: quals.questions.map((q) => (q === q1 ? { ...q, allowedAnswers: ["No" as const] } : q)) };
    expect(questionProblem(noYes.questions[1], noYes)).toMatch(/no longer offers/);
    expect(questionProblem(noYes.questions[0], noYes)).toMatch(/keep Yes among the answers/);
    const words = { ...quals, questions: quals.questions.map((q) => (q === q1 ? { ...q, answerType: "text" as const } : q)) };
    expect(questionProblem(words.questions[0], words)).toMatch(/cannot have follow-up questions/);
    expect(questionProblem(q3)).toBeNull(); // without its section, only its own settings
  });

  it("say what is added or moved before applying", () => {
    const sections = fromVersion(version);
    const q1 = sections[1].questions[0];
    sections[1].questions.splice(1, 0, { ...blankQuestion("0", { parentKey: q1.key, showWhen: "No" }), text: "Why not?" });
    const lines = changeSummary(version, toBody(sections), null);
    expect(lines).toContain('New follow-up question in Qualifications (to Q1, asked when it is No): "Why not?"');
    // Adding it changes no weight.
    expect(toBody(sections)[1].questions.map((q) => q.weight)).toEqual([6, 6, 6]);

    const moved = fromVersion(withFollowUp);
    const q3 = moved[1].questions[1];
    moved[1].questions[1] = { ...q3, showWhen: "No" };
    expect(isEdited(moved[1].questions[1])).toBe(true);
    expect(changeSummary(withFollowUp, toBody(moved), null)).toContain("Q3: now a follow-up to Q1, asked when it is No");
  });
});

import { describe, expect, it } from "vitest";
import { askedQids, followUpLabel, isAsked } from "./followUps";

describe("follow-up questions", () => {
  const form = [
    { qid: "A1", value: "Yes" },
    { qid: "N1", value: "No", parentQid: "A1", showWhen: "Yes" },
    { qid: "N2", value: "No", parentQid: "A1", showWhen: "No" },
    { qid: "A2", value: "No", parentQid: null, showWhen: null },
  ];

  it("asks every ordinary question", () => {
    expect(isAsked({}, new Map())).toBe(true);
    expect(isAsked({ parentQid: null, showWhen: null }, new Map())).toBe(true);
  });

  it("asks a follow-up only on its parent's answer", () => {
    expect([...askedQids(form)]).toEqual(["A1", "N1", "A2"]);
    const flipped = form.map((q) => (q.qid === "A1" ? { ...q, value: "No" } : q));
    expect([...askedQids(flipped)]).toEqual(["A1", "N2", "A2"]);
    const na = form.map((q) => (q.qid === "A1" ? { ...q, value: "N/A" } : q));
    expect([...askedQids(na)]).toEqual(["A1", "A2"]);
  });

  it("says why a follow-up is asked", () => {
    expect(followUpLabel({ parentQid: "A1", showWhen: "Yes" })).toBe("Asked because A1 is Yes");
    expect(followUpLabel({})).toBeNull();
  });
});

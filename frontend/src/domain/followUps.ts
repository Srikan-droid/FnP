/**
 * Follow-up questions: a question asked only when its parent (a Yes/No question) has a given
 * answer. One level only. The same rule as the backend's catalogue.asked, so the form shows or
 * hides a follow-up the moment its parent's answer changes.
 */

export interface FollowUpLink {
  /** The question this one follows on from; absent or null for an ordinary question. */
  parentQid?: string | null;
  /** The parent's answer that asks it. */
  showWhen?: string | null;
}

/** Whether a question is asked, given every question's current answer (qid -> answer). */
export function isAsked(question: FollowUpLink, answers: ReadonlyMap<string, string>): boolean {
  if (!question.parentQid) return true;
  return answers.get(question.parentQid) === question.showWhen;
}

/** The codes of the questions the answers ask, in the order given. */
export function askedQids<T extends FollowUpLink & { qid: string; value: string }>(questions: T[]): Set<string> {
  const answers = new Map(questions.map((q) => [q.qid, q.value]));
  return new Set(questions.filter((q) => isAsked(q, answers)).map((q) => q.qid));
}

/** How the form introduces a follow-up: "Asked because Q3 is Yes". */
export function followUpLabel(question: FollowUpLink): string | null {
  if (!question.parentQid) return null;
  return `Asked because ${question.parentQid} is ${question.showWhen}`;
}

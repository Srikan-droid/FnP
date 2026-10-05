import { QUESTIONS } from "../domain/questions";
import type { Answer } from "../domain/types";

/**
 * Reviewer-set overrides for the question set. The published scoring model is the default; a
 * reviewer can change the weight, which answers are offered, and what may be attached.
 *
 * Applied only to applicants who have not yet submitted — a submitted assessment was scored
 * against the configuration in force at the time, and changing it retroactively would silently
 * rewrite a decision that has already been taken.
 */
export interface QuestionConfig {
  questionWeight: number;
  /** Which of Yes / No / N/A the form offers. */
  answers: Answer[];
  /** Accepted upload formats, without the dot. */
  fileTypes: string[];
  /** 1 = a single document; 2 = a primary plus one supporting document. */
  maxFiles: number;
}

export type ConfigMap = Record<string, QuestionConfig>;

const STORAGE_KEY = "fnp-question-config-v1";

const ALL_ANSWERS: Answer[] = ["Yes", "No", "N/A"];

/** Formats a reviewer can choose from. */
export const AVAILABLE_FILE_TYPES = ["pdf", "xlsx", "csv", "jpg", "png", "docx"];

/** The published model, as the starting point and the "reset" target. */
export function defaultConfig(): ConfigMap {
  const map: ConfigMap = {};
  for (const q of QUESTIONS) {
    const allowsNA = q.qid === "T2";
    const supporting = q.qid === "FC5" || q.qid === "FC7";
    map[q.qid] = {
      questionWeight: q.questionWeight,
      answers: allowsNA ? ALL_ANSWERS : ["Yes", "No"],
      fileTypes: supporting ? ["pdf", "xlsx", "csv"] : ["pdf"],
      maxFiles: supporting ? 2 : 1,
    };
  }
  return map;
}

export function readConfig(): ConfigMap {
  const base = defaultConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Partial<ConfigMap>;
    for (const [qid, value] of Object.entries(stored)) {
      if (base[qid] && value) base[qid] = { ...base[qid], ...value };
    }
    return base;
  } catch {
    return base;
  }
}

export function saveConfig(config: ConfigMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignored
  }
}

export function resetConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored
  }
}

export function configFor(qid: string): QuestionConfig | undefined {
  return readConfig()[qid];
}

/** True once the reviewer has saved anything that differs from the published model. */
export function isCustomised(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function totalWeight(config: ConfigMap): number {
  return Object.values(config).reduce((sum, c) => sum + c.questionWeight, 0);
}

export const REQUIRED_TOTAL_WEIGHT = 100;

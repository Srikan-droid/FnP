import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { QUESTIONS } from "../domain/questions";
import { displaySection } from "../domain/sectionLabels";
import { REVIEWABLE_ASSIGNMENTS } from "../data/assignments";
import { stageFor } from "../state/caseStore";
import {
  AVAILABLE_FILE_TYPES,
  REQUIRED_TOTAL_WEIGHT,
  defaultConfig,
  readConfig,
  resetConfig,
  saveConfig,
  totalWeight,
} from "../state/questionConfigStore";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  InfoIcon,
  SlidersIcon,
} from "../components/icons";
import type { ConfigMap } from "../state/questionConfigStore";
import type { Answer } from "../domain/types";

const ANSWERS: Answer[] = ["Yes", "No", "N/A"];

export default function QuestionConfigPage() {
  const navigate = useNavigate();
  const { role, getForm } = useAssessment();
  const [config, setConfig] = useState<ConfigMap>(() => readConfig());
  const [saved, setSaved] = useState(false);

  // Which applicants a change would actually reach.
  const notSubmitted = useMemo(
    () =>
      REVIEWABLE_ASSIGNMENTS.filter(
        (a) => stageFor(a.id, []) === "NOT_SUBMITTED"
      ).map((a) => a.applicantName),
    []
  );

  if (role !== "reviewer") return <Navigate to="/assessments" replace />;
  void getForm;

  const total = totalWeight(config);
  const balanced = Math.abs(total - REQUIRED_TOTAL_WEIGHT) < 0.001;
  const sections = Array.from(new Set(QUESTIONS.map((q) => q.section)));

  const update = (qid: string, change: Partial<ConfigMap[string]>) => {
    setConfig((prev) => ({ ...prev, [qid]: { ...prev[qid], ...change } }));
    setSaved(false);
  };

  const toggleAnswer = (qid: string, answer: Answer) => {
    const current = config[qid].answers;
    const next = current.includes(answer)
      ? current.filter((a) => a !== answer)
      : [...ANSWERS.filter((a) => current.includes(a) || a === answer)];
    // A question with no answer options could not be filled in at all.
    if (next.length === 0) return;
    update(qid, { answers: next });
  };

  const toggleFileType = (qid: string, type: string) => {
    const current = config[qid].fileTypes;
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...AVAILABLE_FILE_TYPES.filter((t) => current.includes(t) || t === type)];
    if (next.length === 0) return;
    update(qid, { fileTypes: next });
  };

  const apply = () => {
    if (!balanced) return;
    saveConfig(config);
    setSaved(true);
  };

  const restore = () => {
    resetConfig();
    setConfig(defaultConfig());
    setSaved(false);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Question configuration</h1>
          <p className="page-sub">
            Weight, answer options and attachment rules for each of the {QUESTIONS.length}
            questions. Changes reach applicants who have not submitted yet — an assessment already
            submitted keeps the configuration it was scored against.
          </p>
        </div>
        <div className="page-head-aside">
          <span className={`chip chip-${balanced ? "low" : "critical"}`}>
            Total weight {total} / {REQUIRED_TOTAL_WEIGHT}
          </span>
        </div>
      </header>

      {!balanced && (
        <div className="notice notice-critical">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>Question weights must total {REQUIRED_TOTAL_WEIGHT}.</strong> They currently
            total {total}, which is {Math.abs(total - REQUIRED_TOTAL_WEIGHT)}{" "}
            {total > REQUIRED_TOTAL_WEIGHT ? "over" : "under"}. Rebalance before applying.
          </div>
        </div>
      )}

      {saved && balanced && (
        <div className="notice notice-good">
          <CheckCircleIcon size={17} />
          <div>
            <strong>Configuration applied.</strong>{" "}
            {notSubmitted.length > 0
              ? `It takes effect for ${notSubmitted.join(", ")}, who have not submitted yet.`
              : "No applicant is currently unsubmitted, so nothing changes until a new assessment starts."}
          </div>
        </div>
      )}

      <div className="notice notice-info">
        <InfoIcon size={17} />
        <div>
          Weight drives the risk score. Answer options and attachment rules drive the data
          collection form: a question set to a single file shows one picker, two allows a
          supporting document alongside the primary.
        </div>
      </div>

      {sections.map((section) => {
        const items = QUESTIONS.filter((q) => q.section === section);
        const sectionTotal = items.reduce((sum, q) => sum + config[q.qid].questionWeight, 0);
        return (
          <section className="card section" key={section}>
            <div className="section-head section-head-static">
              <span className="section-title">{displaySection(section)}</span>
              <span className="section-count">
                {sectionTotal} of {items[0].sectionWeight} section weight
              </span>
            </div>
            <div className="section-body">
              {items.map((q) => {
                const c = config[q.qid];
                return (
                  <article className="qconfig" key={q.qid}>
                    <div className="qconfig-prompt">
                      <span className="qid">{q.qid}</span>
                      <p className="qtext">{q.question}</p>
                    </div>

                    <div className="qconfig-grid">
                      <div className="qconfig-field">
                        <label className="field-label" htmlFor={`w-${q.qid}`}>
                          Weight
                        </label>
                        <input
                          id={`w-${q.qid}`}
                          className="input input-sm input-num"
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={c.questionWeight}
                          onChange={(e) =>
                            update(q.qid, { questionWeight: Number(e.target.value) || 0 })
                          }
                        />
                      </div>

                      <div className="qconfig-field">
                        <span className="field-label">Answer options</span>
                        <div className="chipset">
                          {ANSWERS.map((a) => (
                            <button
                              key={a}
                              type="button"
                              className={`toggle-chip${c.answers.includes(a) ? " is-on" : ""}`}
                              aria-pressed={c.answers.includes(a)}
                              onClick={() => toggleAnswer(q.qid, a)}
                            >
                              {a}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="qconfig-field">
                        <span className="field-label">Accepted file types</span>
                        <div className="chipset">
                          {AVAILABLE_FILE_TYPES.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={`toggle-chip${c.fileTypes.includes(t) ? " is-on" : ""}`}
                              aria-pressed={c.fileTypes.includes(t)}
                              onClick={() => toggleFileType(q.qid, t)}
                            >
                              {t.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="qconfig-field">
                        <label className="field-label" htmlFor={`f-${q.qid}`}>
                          Files allowed
                        </label>
                        <select
                          id={`f-${q.qid}`}
                          className="input input-sm"
                          value={c.maxFiles}
                          onChange={(e) => update(q.qid, { maxFiles: Number(e.target.value) })}
                        >
                          <option value={1}>1 — primary only</option>
                          <option value={2}>2 — primary and supporting</option>
                        </select>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate("/reviewer")}>
          <ArrowLeftIcon size={15} />
          Back to the queue
        </button>
        <button className="btn btn-ghost" onClick={restore}>
          Restore published model
        </button>
        <button
          className="btn btn-primary"
          disabled={!balanced}
          onClick={apply}
          title={balanced ? undefined : `Weights must total ${REQUIRED_TOTAL_WEIGHT}`}
        >
          <SlidersIcon size={15} />
          Apply configuration
        </button>
      </footer>
    </div>
  );
}

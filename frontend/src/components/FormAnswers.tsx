import { useRef, useState } from "react";
import AnswerTag from "./AnswerTag";
import ReadMore from "./ReadMore";
import { useClipped } from "../state/clipped";
import { AlertTriangleIcon, ExternalLinkIcon, FileTextIcon } from "./icons";
import { displaySection } from "../domain/sectionLabels";
import { followUpLabel } from "../domain/followUps";
import type { ApplicationForm } from "../domain/types";

/** A question cut to a few lines, with "Read more" to show it whole. */
function QuestionText({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const clipped = useClipped(ref, text);
  return (
    <div className="review-question-line">
      <p ref={ref} className={`review-question${full ? " is-full" : ""}`}>
        {text}
      </p>
      <ReadMore clipped={clipped} full={full} onToggle={() => setFull((v) => !v)} />
    </div>
  );
}

/**
 * The form's answers and documents, read-only: every question with its answer and attached
 * evidence by section, then the CV. The applicant checks it before submitting; the reviewer reads
 * a draft with it before submission.
 */
export default function FormAnswers({ form }: { form: ApplicationForm }) {
  const sections = Array.from(new Set(form.responses.map((r) => r.section)));
  const cv = form.cv_verification;
  const cvFile = cv?.evidence[0];

  return (
    <>
      <section className="card">
        <div className="table-wrap">
          <table className="data-table review-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col" className="col-answer">
                  Answer
                </th>
                <th scope="col" className="col-attachment">
                  Evidence
                </th>
              </tr>
            </thead>

            {sections.map((section) => (
              <tbody key={section}>
                <tr className="review-group-row">
                  <th colSpan={3} scope="colgroup">
                    {displaySection(section)}
                  </th>
                </tr>
                {form.responses
                  .filter((r) => r.section === section)
                  .map((r) => (
                    <tr key={r.qid} className={r.parentQid ? "is-follow-up" : undefined}>
                      <td>
                        <div className="review-question-cell">
                          <span className="qid">{r.qid}</span>
                          <div className="review-question-text">
                            {r.parentQid && <span className="review-follow-up">{followUpLabel(r)}</span>}
                            <QuestionText text={r.question} />
                          </div>
                        </div>
                      </td>
                      <td>
                        <AnswerTag answer={r.answer} />
                      </td>
                      <td>
                        {!r.evidence_required ? (
                          <span className="review-evidence-none">Not required</span>
                        ) : r.evidence.length > 0 ? (
                          <span className="review-evidence-cell">
                            {r.evidence.map((file) => {
                              const fileName = file.fileName;
                              const label =
                                file.role === "supporting" ? "Supporting" : "Attached";
                              return (
                                <a
                                  className="review-evidence-link"
                                  key={file.id}
                                  href={file.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={fileName}
                                  aria-label={`View ${fileName}`}
                                >
                                  <FileTextIcon size={13} />
                                  {label}
                                  <ExternalLinkIcon size={11} />
                                </a>
                              );
                            })}
                          </span>
                        ) : (
                          <span className="review-evidence-missing">
                            <AlertTriangleIcon size={13} />
                            Missing
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      {cv && (
        <section className="card">
          <div className="section-head section-head-static">
            <span className="section-title">Curriculum vitae</span>
            <span className="section-count">Supplementary</span>
          </div>
          <div className="review-cv">
            <span className="qid">CV</span>
            <span className="review-cv-text">Curriculum vitae</span>
            {cvFile ? (
              <a
                className="review-evidence-link"
                href={cvFile.url}
                target="_blank"
                rel="noreferrer"
                title={cvFile.fileName}
              >
                <FileTextIcon size={13} />
                Attached
                <ExternalLinkIcon size={11} />
              </a>
            ) : (
              <span className="review-evidence-missing">
                <AlertTriangleIcon size={13} />
                Missing
              </span>
            )}
          </div>
        </section>
      )}
    </>
  );
}

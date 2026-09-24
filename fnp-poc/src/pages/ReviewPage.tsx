import { useNavigate, useParams } from "react-router-dom";
import { useAssessment } from "../state/AssessmentContext";
import { getAssignment, departmentFor } from "../data/assignments";
import AssessmentNotFound from "../components/AssessmentNotFound";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ExternalLinkIcon,
  FileTextIcon,
} from "../components/icons";
import { evidenceUrl } from "../data/fixtures";
import { hasMissingMandatoryEvidence } from "../domain/evidenceRules";
import { recordSubmission } from "../state/submissionStore";
import { displaySection } from "../domain/sectionLabels";

export default function ReviewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getForm } = useAssessment();
  const assignment = getAssignment(id);

  if (!assignment) return <AssessmentNotFound />;

  const form = getForm(assignment);
  const sections = Array.from(new Set(form.responses.map((r) => r.section)));
  const missing = form.responses.filter(hasMissingMandatoryEvidence);

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Review and submit</h1>
          <p className="page-sub">
            Check your answers before submitting. Nothing is scored until every value has been
            authenticated against your documents.
          </p>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Requested by</dt>
            <dd>{departmentFor(assignment).name}</dd>
          </div>
          <div>
            <dt>Entity</dt>
            <dd>{assignment.entity}</dd>
          </div>
          <div>
            <dt>Position applied for</dt>
            <dd>{assignment.position}</dd>
          </div>
        </dl>
      </header>

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
                    <tr key={r.qid}>
                      <td>
                        <div className="review-question-cell">
                          <span className="qid">{r.qid}</span>
                          <p className="review-question">{r.question}</p>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`answer-tag answer-${r.answer.toLowerCase().replace("/", "")}`}
                        >
                          {r.answer}
                        </span>
                      </td>
                      <td>
                        {!r.evidence_required ? (
                          <span className="review-evidence-none">Not required</span>
                        ) : r.evidence.length > 0 ? (
                          (() => {
                            const fileName =
                              r.evidence[0].path.split("/").pop() ?? r.evidence[0].path;
                            return (
                              <a
                                className="review-evidence-link"
                                href={evidenceUrl(assignment.applicantId, fileName)}
                                target="_blank"
                                rel="noreferrer"
                                title={fileName}
                                aria-label={`View ${fileName}`}
                              >
                                <FileTextIcon size={13} />
                                Attached
                                <ExternalLinkIcon size={11} />
                              </a>
                            );
                          })()
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

      {missing.length > 0 ? (
        <div className="notice notice-warning">
          <AlertTriangleIcon size={17} />
          <div>
            <strong>
              {missing.length} mandatory document{missing.length > 1 ? "s" : ""} not attached
            </strong>{" "}
            ({missing.map((r) => r.qid).join(", ")}). Submitting is allowed in this proof of
            concept — the engine returns an <code>EVIDENCE_MISSING</code> verdict during
            authentication.
          </div>
        </div>
      ) : (
        <div className="notice notice-good">
          <CheckCircleIcon size={17} />
          <div>
            <strong>All mandatory evidence is attached.</strong> Your submission is ready for
            authentication.
          </div>
        </div>
      )}

      <footer className="actionbar">
        <button className="btn btn-ghost" onClick={() => navigate(`/apply/${assignment.id}`)}>
          <ArrowLeftIcon size={15} />
          Back to edit
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            recordSubmission(assignment.id);
            navigate(`/apply/${assignment.id}/status`);
          }}
        >
          Submit application
          <ArrowRightIcon size={15} />
        </button>
      </footer>
    </div>
  );
}

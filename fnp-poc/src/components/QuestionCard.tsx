import AnswerToggle from "./AnswerToggle";
import EvidenceBlock from "./EvidenceBlock";
import { answerOptionsFor } from "../domain/questions";
import type { Answer, ResponseItem } from "../domain/types";

export default function QuestionCard({
  response,
  onAnswerChange,
  onAttachEvidence,
  onRemoveEvidence,
}: {
  response: ResponseItem;
  onAnswerChange: (qid: string, answer: Answer) => void;
  onAttachEvidence: (qid: string, optionCode: string, description?: string) => void;
  onRemoveEvidence: (qid: string, docType: string) => void;
}) {
  const labelId = `q-${response.qid}-label`;

  return (
    <article className="qcard">
      <div className="qcard-main">
        <div className="qcard-prompt">
          <span className="qid">{response.qid}</span>
          <p className="qtext" id={labelId}>
            {response.question}
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </p>
        </div>
        <AnswerToggle
          value={response.answer}
          options={answerOptionsFor(response.qid, response.answer)}
          labelledBy={labelId}
          onChange={(answer) => onAnswerChange(response.qid, answer)}
        />
      </div>

      {response.evidence_required && (
        <EvidenceBlock
          qid={response.qid}
          evidence={response.evidence}
          onAttach={(optionCode, description) =>
            onAttachEvidence(response.qid, optionCode, description)
          }
          onRemove={(docType) => onRemoveEvidence(response.qid, docType)}
        />
      )}
    </article>
  );
}

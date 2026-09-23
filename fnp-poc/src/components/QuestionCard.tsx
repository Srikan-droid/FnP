import AnswerToggle from "./AnswerToggle";
import EvidenceBlock from "./EvidenceBlock";
import { DOC_TYPE_BY_QID } from "../domain/evidenceRules";
import type { Answer, ResponseItem } from "../domain/types";

export default function QuestionCard({
  applicantId,
  response,
  onAnswerChange,
  onAttachEvidence,
}: {
  applicantId: string;
  response: ResponseItem;
  onAnswerChange: (qid: string, answer: Answer) => void;
  onAttachEvidence: (qid: string) => void;
}) {
  const labelId = `q-${response.qid}-label`;

  return (
    <article className="qcard">
      <div className="qcard-main">
        <div className="qcard-prompt">
          <span className="qid">{response.qid}</span>
          <p className="qtext" id={labelId}>
            {response.question}
          </p>
        </div>
        <AnswerToggle
          value={response.answer}
          labelledBy={labelId}
          onChange={(answer) => onAnswerChange(response.qid, answer)}
        />
      </div>

      {response.evidence_required && (
        <EvidenceBlock
          applicantId={applicantId}
          evidence={response.evidence}
          docType={DOC_TYPE_BY_QID[response.qid] ?? "document"}
          onAttach={() => onAttachEvidence(response.qid)}
        />
      )}
    </article>
  );
}

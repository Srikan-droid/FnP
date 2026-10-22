import AnswerToggle from "./AnswerToggle";
import EvidenceBlock from "./EvidenceBlock";
import { answerOptionsFor } from "../domain/questions";
import type { Answer, EvidenceRole, ResponseItem } from "../domain/types";
import type { QuestionConfig } from "../state/questionConfigStore";
import type { UploadedFileMeta } from "../state/uploadStore";

export default function QuestionCard({
  response,
  config,
  uploadUrlFor,
  draggingFile,
  onDropUpload,
  onAnswerChange,
  onAttachEvidence,
  onRemoveEvidence,
}: {
  response: ResponseItem;
  /** Reviewer configuration in force for this filer, when it applies. */
  config?: QuestionConfig;
  uploadUrlFor?: (uploadId: string) => string | null;
  draggingFile?: UploadedFileMeta | null;
  onDropUpload?: (qid: string, uploadId: string, role: EvidenceRole, optionCode: string) => void;
  onAnswerChange: (qid: string, answer: Answer) => void;
  onAttachEvidence: (
    qid: string,
    optionCode: string,
    role: EvidenceRole,
    description?: string
  ) => void;
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
          options={answerOptionsFor(response.qid, response.answer, config?.answers)}
          labelledBy={labelId}
          onChange={(answer) => onAnswerChange(response.qid, answer)}
        />
      </div>

      {response.evidence_required && (
        <EvidenceBlock
          qid={response.qid}
          evidence={response.evidence}
          fileTypes={config?.fileTypes}
          allowSupporting={config ? config.maxFiles > 1 : undefined}
          uploadUrlFor={uploadUrlFor}
          draggingFile={draggingFile}
          onDropUpload={
            onDropUpload
              ? (uploadId, role, optionCode) =>
                  onDropUpload(response.qid, uploadId, role, optionCode)
              : undefined
          }
          onAttach={(optionCode, role, description) =>
            onAttachEvidence(response.qid, optionCode, role, description)
          }
          onRemove={(docType) => onRemoveEvidence(response.qid, docType)}
        />
      )}
    </article>
  );
}

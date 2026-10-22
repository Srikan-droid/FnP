import { useRef, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  FileTextIcon,
  InfoIcon,
  UploadIcon,
  XIcon,
} from "./icons";
import type { UploadedFileMeta } from "../state/uploadStore";
import type { UploadsState } from "../state/useUploads";

export const UPLOAD_DRAG_TYPE = "application/x-fnp-upload";

/** A question a given file could be attached to. */
export interface AssignTarget {
  qid: string;
  section: string;
  question: string;
  /** Formats this question accepts, already narrowed by the reviewer's configuration. */
  fileTypes: string[];
  attached: boolean;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The questions a file can go to, given its extension. */
function targetsFor(file: UploadedFileMeta, targets: AssignTarget[]): AssignTarget[] {
  return targets.filter((t) => t.fileTypes.includes(file.extension));
}

/**
 * A docked pane beside the form. It stays small until an archive is read, then expands into the
 * list of extracted files. It is sticky, so a document can be dragged onto a question far down
 * the page without the list scrolling out of reach.
 */
export default function EvidenceTray({
  uploads,
  targets,
  assignedCounts,
  onDragStateChange,
}: {
  uploads: UploadsState;
  targets: AssignTarget[];
  /** How many questions each uploaded file is currently attached to. */
  assignedCounts: Record<string, number>;
  /** Raised while a file is being dragged, so the questions know what is incoming. */
  onDragStateChange: (file: UploadedFileMeta | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ path: string; reason: string }[]>([]);
  const [dropping, setDropping] = useState(false);

  const files = uploads.files;
  const hasFiles = files.length > 0;
  const expanded = hasFiles && !collapsed;

  const handleFile = async (file: File) => {
    setBusy(true);
    setReport(null);
    try {
      const { added, skipped: unread } = await uploads.addZip(file);
      setSkipped(unread);
      setReport(
        added === 0
          ? "No readable files in that archive."
          : `Extracted ${added} file${added === 1 ? "" : "s"}.`
      );
      setCollapsed(false);
    } catch {
      // useUploads surfaces the message through its own error state.
    } finally {
      setBusy(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };


  return (
    <aside className={`tray${expanded ? " is-expanded" : ""}`} aria-label="Evidence bundle">
      <header className="tray-head">
        <span className="tray-icon">
          <UploadIcon size={15} />
        </span>
        <span className="tray-head-text">
          <span className="tray-title">Evidence bundle</span>
          <span className="tray-sub">
            {hasFiles
              ? `${files.length} file${files.length === 1 ? "" : "s"} ready`
              : "Upload a ZIP"}
          </span>
        </span>
        {hasFiles && (
          <button
            className="tray-collapse"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse file list" : "Expand file list"}
            onClick={() => setCollapsed((v) => !v)}
          >
            <ChevronDownIcon size={15} />
          </button>
        )}
      </header>

      <div className="tray-body">
        <div
          className={`tray-drop${dropping ? " is-over" : ""}${hasFiles ? " is-compact" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
        >
          {!hasFiles && <UploadIcon size={18} />}
          <p>
            Drop a <strong>.zip</strong> here, or{" "}
            <button
              className="linkish"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              choose a file
            </button>
            .
          </p>
          {!hasFiles && (
            <span className="tray-drop-hint">
              Each document can then be dragged onto the question it answers.
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="visually-hidden"
            onChange={onPick}
          />
        </div>

        {busy && <p className="tray-note">Reading archive…</p>}
        {uploads.error && (
          <p className="tray-note is-error">
            <AlertTriangleIcon size={13} /> {uploads.error}
          </p>
        )}
        {report && !uploads.error && (
          <p className="tray-note is-good">
            <CheckCircleIcon size={13} /> {report}
          </p>
        )}
        {skipped.length > 0 && (
          <p className="tray-note" title={skipped.map((s) => `${s.path} (${s.reason})`).join("; ")}>
            <InfoIcon size={13} /> {skipped.length} entr
            {skipped.length === 1 ? "y" : "ies"} skipped
          </p>
        )}

        {expanded && (
          <>
            <ul className="tray-files">
              {files.map((file) => {
                const usable = targetsFor(file, targets);
                const count = assignedCounts[file.id] ?? 0;
                const draggable = usable.length > 0;
                const url = uploads.urlFor(file.id);
                return (
                  <li
                    className={`tray-file${draggable ? "" : " is-unusable"}`}
                    key={file.id}
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(UPLOAD_DRAG_TYPE, file.id);
                      e.dataTransfer.setData("text/plain", file.name);
                      e.dataTransfer.effectAllowed = "copy";
                      onDragStateChange(file);
                    }}
                    onDragEnd={() => onDragStateChange(null)}
                  >
                    <span className="tray-file-top">
                      <span className="tray-file-icon">
                        <FileTextIcon size={14} />
                      </span>
                      <span className="tray-file-name" title={file.name}>
                        {file.name}
                      </span>
                      <button
                        className="btn-remove"
                        onClick={() => void uploads.remove(file.id)}
                        aria-label={`Remove ${file.name}`}
                      >
                        <XIcon size={12} />
                      </button>
                    </span>

                    <span className="tray-file-sub">
                      {file.extension.toUpperCase()} · {sizeLabel(file.size)}
                      {count > 0 && (
                        <span className="tray-file-used">
                          {" "}
                          · on {count} question{count === 1 ? "" : "s"}
                        </span>
                      )}
                      {!draggable && (
                        <span className="tray-file-blocked">
                          {" "}
                          · no open question takes {file.extension.toUpperCase()}
                        </span>
                      )}
                    </span>

                    <span className="tray-file-actions">
                      {draggable && <span className="tray-file-drag">Drag onto a question</span>}
                      {url && (
                        <a className="linkish" href={url} target="_blank" rel="noreferrer">
                          View
                        </a>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            <button className="tray-clear linkish" onClick={() => void uploads.clearAll()}>
              Remove all
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

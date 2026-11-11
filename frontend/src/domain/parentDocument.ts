/**
 * A follow-up question can use its parent's document rather than have it uploaded again: the same
 * document from "Your documents", attached to the follow-up too.
 */
import { OTHER_CODE, sameFormat, type EvidenceOption } from "./catalogue";
import type { ResponseItem } from "./types";
import type { LibraryDocument } from "../api/types";

/** One of the parent's main documents, and how it is attached there. */
export interface ParentAttachment {
  /** Its copy in "Your documents". */
  documentId: string;
  /** The type it is attached to the parent as, and the words given for "Other". */
  optionCode: string;
  description: string;
}

/** A follow-up question's parent's main documents (not the supporting ones), in the parent's order. */
export interface ParentDocument {
  /** The parent question's code. */
  parentQid: string;
  documents: ParentAttachment[];
}

/** Each follow-up's parent's documents, by the follow-up's code; a follow-up whose parent has none is left out. */
export function parentDocuments(responses: ResponseItem[]): Map<string, ParentDocument> {
  const byQid = new Map(responses.map((r) => [r.qid, r]));
  const found = new Map<string, ParentDocument>();
  for (const r of responses) {
    const parent = r.parentQid ? byQid.get(r.parentQid) : undefined;
    if (!parent) continue;
    const documents = parent.evidence.flatMap((e) =>
      e.role !== "supporting" && e.documentId
        ? [{ documentId: e.documentId, optionCode: e.option_code, description: e.description }]
        : []
    );
    if (documents.length > 0) found.set(r.qid, { parentQid: parent.qid, documents });
  }
  return found;
}

/** The parent's document offered on the follow-up, with the library copy it attaches. */
export interface ParentOffer extends ParentAttachment {
  parentQid: string;
  doc: LibraryDocument;
}

/**
 * The parent's document the follow-up offers: the first one still in "Your documents" and not on
 * the follow-up already (`choices`), in a format the follow-up takes.
 */
export function parentOffer(
  parent: ParentDocument | undefined,
  choices: LibraryDocument[],
  fileTypes: string[]
): ParentOffer | undefined {
  if (!parent) return undefined;
  const accepted = fileTypes.map(sameFormat);
  for (const attachment of parent.documents) {
    const doc = choices.find((d) => d.id === attachment.documentId);
    if (doc && accepted.includes(sameFormat(doc.format))) return { ...attachment, parentQid: parent.parentQid, doc };
  }
  return undefined;
}

/** Whether the document is the same one as one of the parent's: its row then says so. */
export function isParentsDocument(parent: ParentDocument | undefined, documentId: string | null | undefined): boolean {
  return Boolean(parent && documentId && parent.documents.some((d) => d.documentId === documentId));
}

/**
 * What "Use the same document" does on the follow-up: attach it at once as the parent's type when
 * the follow-up takes that type (for "Other", with the parent's words); ask for the words when the
 * parent's "Other" has none; otherwise ask for one of the follow-up's own types.
 */
export type ParentPlan =
  | { kind: "attach"; optionCode: string; description: string }
  | { kind: "describe" }
  | { kind: "choose" };

export function parentPlan(offer: ParentAttachment, options: EvidenceOption[]): ParentPlan {
  if (!options.some((o) => o.code === offer.optionCode)) return { kind: "choose" };
  if (offer.optionCode === OTHER_CODE && !offer.description.trim()) return { kind: "describe" };
  return { kind: "attach", optionCode: offer.optionCode, description: offer.description };
}

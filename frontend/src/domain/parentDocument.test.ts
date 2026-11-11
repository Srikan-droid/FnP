import { describe, expect, it } from "vitest";
import { OTHER_CODE } from "./catalogue";
import { isParentsDocument, parentDocuments, parentOffer, parentPlan } from "./parentDocument";
import type { EvidenceRef, ResponseItem } from "./types";
import type { LibraryDocument } from "../api/types";

const evidence = (documentId: string | null, extra: Partial<EvidenceRef> = {}): EvidenceRef => ({
  id: `e-${documentId}`,
  option_code: "PASSPORT",
  doc_type: "PASSPORT",
  role: "primary",
  description: "",
  fileName: `${documentId}.pdf`,
  url: "",
  documentId,
  ...extra,
});

const response = (qid: string, evidenceList: EvidenceRef[] = [], parentQid: string | null = null): ResponseItem => ({
  qid,
  section: "Identity",
  question: "",
  answer: "Yes",
  answerType: "choice",
  evidence_required: true,
  evidence: evidenceList,
  checks_to_perform: [],
  parentQid,
  showWhen: parentQid ? "Yes" : null,
});

const libraryDoc = (id: string, format = "pdf"): LibraryDocument => ({
  id,
  fileName: `${id}.${format}`,
  sizeBytes: 1,
  contentType: "application/pdf",
  format,
  uploadedAt: "",
  url: "",
  usedBy: [],
});

describe("a follow-up using its parent's document", () => {
  it("finds each follow-up's parent's main documents, in order", () => {
    const found = parentDocuments([
      response("A1", [evidence("d1"), evidence("d2", { role: "supporting" }), evidence("d3"), evidence(null)]),
      response("A1-1", [], "A1"),
      response("A2"),
      response("A2-1", [], "A2"),
    ]);
    expect(found.get("A1-1")).toEqual({
      parentQid: "A1",
      documents: [
        { documentId: "d1", optionCode: "PASSPORT", description: "" },
        { documentId: "d3", optionCode: "PASSPORT", description: "" },
      ],
    });
    // A parent with no document, and an ordinary question, offer nothing.
    expect(found.has("A2-1")).toBe(false);
    expect(found.has("A1")).toBe(false);
  });

  const parent = {
    parentQid: "A1",
    documents: [
      { documentId: "d1", optionCode: "PASSPORT", description: "" },
      { documentId: "d2", optionCode: "NATIONAL_ID", description: "" },
    ],
  };

  it("offers the first of them still free to attach, in a format the follow-up takes", () => {
    expect(parentOffer(parent, [libraryDoc("d1"), libraryDoc("d2")], ["pdf"])?.doc.id).toBe("d1");
    // d1 already on the follow-up (so not among its choices): d2 is offered instead.
    expect(parentOffer(parent, [libraryDoc("d2")], ["pdf"])?.documentId).toBe("d2");
    // Formats compare as one (jpeg is jpg).
    expect(parentOffer(parent, [libraryDoc("d1", "jpeg")], ["jpg"])?.doc.id).toBe("d1");
    expect(parentOffer(parent, [libraryDoc("d1", "png")], ["pdf"])).toBeUndefined();
    expect(parentOffer(undefined, [libraryDoc("d1")], ["pdf"])).toBeUndefined();
  });

  it("tells any of the parent's documents on the follow-up", () => {
    expect(isParentsDocument(parent, "d2")).toBe(true);
    expect(isParentsDocument(parent, "d9")).toBe(false);
    expect(isParentsDocument(parent, null)).toBe(false);
    expect(isParentsDocument(undefined, "d1")).toBe(false);
  });

  const options = [
    { code: "PASSPORT", label: "Passport", docType: "PASSPORT" },
    { code: OTHER_CODE, label: "Other", docType: "OTHER" },
  ];

  it("attaches at once as the parent's type when the follow-up takes it", () => {
    expect(parentPlan({ documentId: "d1", optionCode: "PASSPORT", description: "" }, options)).toEqual({
      kind: "attach",
      optionCode: "PASSPORT",
      description: "",
    });
    expect(parentPlan({ documentId: "d1", optionCode: OTHER_CODE, description: "Deed poll" }, options)).toEqual({
      kind: "attach",
      optionCode: OTHER_CODE,
      description: "Deed poll",
    });
  });

  it("asks for the words when the parent's Other has none", () => {
    expect(parentPlan({ documentId: "d1", optionCode: OTHER_CODE, description: " " }, options)).toEqual({ kind: "describe" });
  });

  it("asks for one of the follow-up's own types when it does not take the parent's", () => {
    expect(parentPlan({ documentId: "d1", optionCode: "NATURALISATION", description: "" }, options)).toEqual({ kind: "choose" });
  });
});

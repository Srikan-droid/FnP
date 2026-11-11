"""Translation between our data and the Data Authentication API's formats, in both directions.

Outbound, only what the engine needs leaves the system: the four applicant fields it reads (not
nationality, ID number or phone) and files under neutral names. Inbound, every engine link is
replaced by our own access-checked one, so no engine URL or request id reaches the browser."""

import re
from dataclasses import dataclass, field

from django.utils import timezone

from . import catalogue, validation
from .models import (
    ApplicantProfile,
    Assessment,
    EvidenceFile,
    EvidenceRole,
    Question,
    Submission,
    Verdict,
)

CV_DOC_TYPE = "curriculum_vitae"
# Anything after the page number (a stray quote, say) is dropped.
_HIGHLIGHT = re.compile(r"/authentication/evidence-highlight/[^/]+/([A-Za-z0-9._-]+\.pdf)(?:#page=(\d+)[^/]*)?$")


# ---- Outbound ---------------------------------------------------------------------------------

@dataclass(frozen=True)
class RunHistory:
    """What a submission says about the ones before it, worked out from the case's earlier runs.

    version: this submission's number (1 for the first; a retry resends a run, so it adds none).
    reviews: the reviewer's ruling on each question flagged in the latest run, accepted or
        rejected, with its comment (the latest round only).
    sent: for each question, the sets of documents earlier runs carried (each by
        EvidenceFile.identity, so the same file attached again as the same type is the same
        document), one per change.
    previous_request_id: the engine's id for the latest run (the one the reviewer ruled on); None
        before any run.
    """

    version: int = 1
    reviews: dict[str, dict] = field(default_factory=dict)
    sent: dict[str, list[frozenset[tuple]]] = field(default_factory=dict)
    previous_request_id: str | None = None


def run_history(previous: list[Submission]) -> RunHistory:
    """The history for a new submission from the case's earlier runs, oldest first (with their
    documents and rulings loaded). A retry resends its run's request word for word, submission
    time included, so the distinct submission times count the submissions made."""
    if not previous:
        return RunHistory()
    version = len({run.payload.get("submitted_at") for run in previous}) + 1
    reviews = {r.qid: {"verdict": r.verdict, "comment": r.comment} for r in previous[-1].rulings.all()}
    sent: dict[str, list[frozenset[tuple]]] = {}
    for run in previous:
        by_qid: dict[str, set[tuple]] = {}
        for e in run.evidence_files.all():
            by_qid.setdefault(e.qid, set()).add(e.identity)
        for qid, pks in by_qid.items():
            versions = sent.setdefault(qid, [])
            if not versions or versions[-1] != frozenset(pks):
                versions.append(frozenset(pks))
    return RunHistory(
        version=version, reviews=reviews, sent=sent, previous_request_id=previous[-1].engine_request_id,
    )


def _label(n: int | None) -> str | None:
    return None if n is None else f"v{n}"


def _evidence_version(history: RunHistory, qid: str, files: list[EvidenceFile]) -> int | None:
    """Which version of a question's documents this is: 1 the first time any go, one more each time
    they change. None when it takes none now."""
    if not files:
        return None
    versions = history.sent.get(qid, [])
    now = frozenset(e.identity for e in files)
    if versions and versions[-1] == now:
        return len(versions)
    return len(versions) + 1


def submission_payload(
    assessment: Assessment,
    questions: dict[str, Question],
    answers: dict[str, str],
    profile: ApplicantProfile | None,
    evidence: list[EvidenceFile],
    history: RunHistory | None = None,
    shown: set[str] | None = None,
) -> dict:
    """The submission in the format the engine reads (the test set's form_data with a
    cv_verification block). Unanswered questions are No, as on the form.

    The questions the applicant was asked go, in form order. A follow-up question names the
    question it follows on from (parent_qid) and the answer that asks it (show_when); one these
    answers did not ask (`shown`, from catalogue.asked; None: all asked) is not sent at all, as the
    applicant never saw it. Ordinary questions go with no parent.

    On a resubmission it also says what changed since the last run: each question the reviewer
    sent back (rejected) is marked resubmitted, and so is a section holding one; every question
    the reviewer ruled on, accepted or rejected, carries the verdict and comment; the request
    names the engine's id for the run it follows; and the submission and each question's
    documents carry a version (v1, v2 ...). A first submission sends the same fields, all false,
    v1 and null."""
    history = history or RunHistory()
    by_qid: dict[str, list[EvidenceFile]] = {}
    for e in evidence:
        by_qid.setdefault(e.qid, []).append(e)

    sections: list[dict] = []
    for q in questions.values():
        # A follow-up the answers did not ask was never shown to the applicant: it is not sent.
        if shown is not None and q.qid not in shown:
            continue
        if not sections or sections[-1]["section"] != q.section.name:
            sections.append({
                "section": q.section.name, "section_weight": float(q.section.weight),
                "resubmitted": False, "questions": [],
            })
        answer = answers.get(q.qid, catalogue.default_answer(q))
        files = by_qid.get(q.qid, [])
        review = history.reviews.get(q.qid)
        # Sent back by the reviewer, so changed by the applicant. One the reviewer accepted is not,
        # though its review (and comment) still goes.
        sent_back = review is not None and review["verdict"] == Verdict.REJECTED
        sections[-1]["questions"].append({
            "qid": q.qid,
            "question": q.text,
            "question_weight": float(q.weight),
            "polarity": q.polarity,
            "knockout": int(q.is_knockout),
            "answer": answer,
            "evidence_required": catalogue.evidence_required(q, answer),
            "evidence": [{"doc_type": e.doc_type, "role": e.role} for e in files],
            "checks_to_perform": q.checks,
            "resubmitted": sent_back,
            "evidence_version": _label(_evidence_version(history, q.qid, files)),
            "reviewer_review": review,
            # A follow-up question: the question it follows on from and the answer that asks it
            # (null for an ordinary question).
            "parent_qid": catalogue.parent_qid(q),
            "show_when": q.show_when or None,
        })
        # A section is resubmitted when any of its questions is; all false, it is false.
        if sent_back:
            sections[-1]["resubmitted"] = True

    return {
        "application_id": assessment.public_id,
        "is_resubmission": history.version > 1,
        "submission_version": _label(history.version),
        "previous_submission_version": _label(history.version - 1 if history.version > 1 else None),
        "previous_request_id": history.previous_request_id,
        "licensee": assessment.entity,
        "applicant": {
            "full_name": assessment.applicant_name,
            "proposed_role": assessment.position,
            "date_of_birth": profile.date_of_birth.isoformat() if profile and profile.date_of_birth else "",
            "town": profile.town if profile else "",
        },
        "submitted_at": timezone.now().isoformat(),
        "sections": sections,
        "cv_verification": {
            "doc_type": CV_DOC_TYPE,
            "mandatory": True,
            "evidence": [{"doc_type": e.doc_type, "role": EvidenceRole.PRIMARY} for e in by_qid.get("CV", [])],
            "checks_to_perform": ["Document_Check", "Name_Check"],
        },
    }


def submission_files(evidence: list[EvidenceFile]) -> list[tuple[str, object, str, str]]:
    """(name, open file, content type, doc_type) per document. Names are neutral — the doc type
    and a counter — so the applicant's own file names are not passed on."""
    files, seen = [], {}
    try:
        for e in evidence:
            ext = validation.extension(e.original_name) or "bin"
            seen[e.doc_type] = seen.get(e.doc_type, 0) + 1
            name = f"{e.doc_type}{'' if seen[e.doc_type] == 1 else seen[e.doc_type]}.{ext}"
            files.append((name, e.file.open("rb"), e.content_type, e.doc_type))
    except BaseException:
        # One document missing from storage: the caller never receives the list, so the files
        # already opened are closed here rather than left open in a long-running worker.
        for _, fh, *_ in files:
            fh.close()
        raise
    return files


# ---- Inbound ----------------------------------------------------------------------------------

def highlight_url(assessment: Assessment, engine_url: str | None) -> str | None:
    """Our link for one of the engine's highlighted PDFs, keeping the page anchor."""
    match = _HIGHLIGHT.search(engine_url or "")
    if not match:
        return None
    name, page = match.groups()
    return f"/api/assessments/{assessment.public_id}/highlights/{name}" + (f"#page={page}" if page else "")


def question_results(result: dict) -> list[dict]:
    """One row per question for the question_result table."""
    rows = []
    for section in result.get("sections", []):
        for q in section.get("questions", []):
            determination = q.get("determination") or {}
            rows.append({
                "qid": q["qid"],
                "status": q["question_status"],
                "verdict": determination.get("verdict") or "",
                "confidence": q.get("confidence"),
            })
    return rows


def authentication(
    assessment: Assessment, result: dict, evidence: list[EvidenceFile], not_asked: set[str] = frozenset()
) -> dict:
    """The engine's authentication result in the API's shape, with our links. A follow-up question
    the run did not ask (`not_asked`) is left out: it was not the applicant's to answer."""
    # A question can hold two documents of the same type (a primary and a supporting one), so each
    # is found by its role too; the type alone is the fallback for an entry that names no role.
    files: dict[tuple, EvidenceFile] = {}
    for e in evidence:
        files.setdefault((e.qid, e.doc_type, e.role), e)
        files.setdefault((e.qid, e.doc_type, None), e)

    def document(qid: str, doc: dict) -> dict:
        own = files.get((qid, doc.get("doc_type"), doc.get("role"))) or files.get((qid, doc.get("doc_type"), None))
        return {
            "docType": doc.get("doc_type"),
            "role": doc.get("role"),
            "status": doc.get("document_status"),
            "url": f"/api/assessments/{assessment.public_id}/evidence/{own.public_id}/file" if own else None,
        }

    def question(q: dict) -> dict:
        d = q.get("determination")
        return {
            "qid": q["qid"],
            "question": q.get("question"),
            "answer": q.get("user_answer"),
            "status": q["question_status"],
            "confidence": q.get("confidence"),
            "summary": q.get("summary"),
            "checks": [
                {
                    "name": c.get("name"),
                    "label": c.get("label"),
                    "status": c.get("check_status"),
                    "confidence": c.get("confidence"),
                    "note": c.get("note"),
                }
                for c in q.get("checks", [])
            ],
            "determination": None if not d else {
                "engineAnswer": d.get("engine_answer"),
                "verdict": d.get("verdict"),
                "note": d.get("note"),
                "evidenceLine": d.get("evidence_line"),
                "highlightUrl": highlight_url(assessment, d.get("evidence_url")),
            },
            "documents": [document(q["qid"], doc) for doc in q.get("evidence_documents", [])],
        }

    def finding(f: dict) -> dict:
        return {**f, "evidence_url": highlight_url(assessment, f.get("evidence_url"))}

    summary = result.get("data_authentication_summary", {})
    cv = result.get("cvVerification")
    sections = [_section(s, question, not_asked) for s in result.get("sections", [])]
    is_clean, with_issues = summary.get("isClean"), summary.get("questionsWithIssues")
    reported = sum(len(s.get("questions", [])) for s in result.get("sections", []))
    if sum(len(s["questions"]) for s in sections) != reported:
        # A follow-up the run did not ask was left out (the engine reported on it all the same):
        # the counts are of the questions shown. The outcome stays the engine's, which the run
        # has already acted on.
        with_issues = sum(s["issueCount"] for s in sections)
        is_clean = bool(is_clean) or (with_issues == 0 and not (cv or {}).get("flagCount"))
    return {
        "outcome": summary.get("outcome"),
        "isClean": is_clean,
        "overallConfidence": summary.get("overallConfidence"),
        "checksRun": summary.get("checksRun"),
        "questionsWithIssues": with_issues,
        "sections": sections,
        "cvVerification": None if not cv else {
            "docType": cv.get("docType"),
            "status": cv.get("status"),
            "gateChecks": cv.get("gateChecks", []),
            "consistencyFindings": [finding(f) for f in cv.get("consistencyFindings", [])],
            "suitabilityFindings": [finding(f) for f in cv.get("suitabilityFindings", [])],
            "flagCount": cv.get("flagCount", 0),
        },
    }


def _section(s: dict, question, not_asked: set[str]) -> dict:
    """One section of the authentication result. Its issue count is the engine's, recounted only
    where a follow-up the run did not ask was left out of it."""
    kept = [q for q in s.get("questions", []) if q.get("qid") not in not_asked]
    dropped = len(kept) != len(s.get("questions", []))
    return {
        "section": s.get("section"),
        "issueCount": sum(1 for q in kept if q.get("question_status") == "issue") if dropped else s.get("issueCount", 0),
        "questions": [question(q) for q in kept],
    }


def score_from_engine(document: dict) -> dict:
    """The engine's score document reduced to the fields we store."""
    summary = document["score_summary"]
    return {
        "risk_score": summary["risk_score"],
        "normalised": summary["normalised_risk_score"],
        "band": summary["risk_band"],
        "knock_out": summary["knock_out_triggered"],
        "recommendation": summary["recommendation"],
        "lines": document.get("questions", []),
    }


def final_assessment(assessment: Assessment, document: dict) -> dict:
    """The engine's written assessment with its links replaced and its request id removed."""
    clean = {k: v for k, v in document.items() if k != "request_id"}
    clean["concerns"] = [
        {**c, "evidence_url": highlight_url(assessment, c.get("evidence_url"))} for c in document.get("concerns", [])
    ]
    return clean

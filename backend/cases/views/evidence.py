import hashlib
import logging
import os
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from engine.client import EngineUnavailable

from .. import audit, catalogue, validation, workflow
from ..models import AnswerValue, Assessment, CaseDocument, EvidenceFile, EvidenceRole, Stage
from ..permissions import assessment_for
from ..storage import delete_files
from .common import Conflict, ServiceUnavailable, lock, require_owner

logger = logging.getLogger(__name__)

# The CV is one document, outside the question set's configuration.
CV_FILE_TYPES = catalogue.CV_FILE_TYPES
# What the library takes: any format a question or the CV may accept. Each question still checks
# its own formats when a document is attached to it.
LIBRARY_FILE_TYPES = sorted(set(catalogue.CONFIGURABLE_FILE_TYPES) | set(CV_FILE_TYPES))


def evidence_payload(assessment: Assessment, e: EvidenceFile) -> dict:
    return {
        "id": str(e.public_id),
        "qid": e.qid,
        "optionCode": e.option_code,
        "docType": e.doc_type,
        "role": e.role,
        "description": e.description,
        "fileName": e.original_name,
        "sizeBytes": e.size_bytes,
        "uploadedAt": e.uploaded_at,
        "url": f"/api/assessments/{assessment.public_id}/evidence/{e.public_id}/file",
        # The library document it attaches; null for one attached before the library existed.
        "documentId": str(e.document.public_id) if e.document_id else None,
    }


def used_by(attachments) -> list[dict]:
    """Where a document is attached now, from its current attachments: [{"qid": "A1", "role":
    "primary"}, ...]."""
    return [{"qid": e.qid, "role": e.role} for e in attachments]


def document_payload(assessment: Assessment, d: CaseDocument, used: list[dict] | None = None) -> dict:
    return {
        "id": str(d.public_id),
        "fileName": d.original_name,
        "sizeBytes": d.size_bytes,
        "contentType": d.content_type,
        "format": validation.extension(d.original_name),
        "uploadedAt": d.uploaded_at,
        "url": f"/api/assessments/{assessment.public_id}/documents/{d.public_id}/file",
        # Its contents' fingerprint: the page tells a file already here from a new one by it.
        "sha256": d.sha256,
        # Where it is attached now (used_by); empty if nowhere.
        "usedBy": used or [],
    }


def library_payload(assessment: Assessment, current: list[EvidenceFile], attached_only: bool = False) -> list[dict]:
    """The application's library, oldest upload first, each with where it is attached now (pass the
    current attachments, already loaded for the form). `attached_only`, for anyone but the applicant:
    only the documents on a question, since one attached nowhere is not part of the application."""
    attached: dict[int, list[EvidenceFile]] = {}
    for e in current:
        if e.document_id:
            attached.setdefault(e.document_id, []).append(e)
    used = {pk: used_by(files) for pk, files in attached.items()}
    return [
        document_payload(assessment, d, used.get(d.pk))
        for d in assessment.library.order_by("uploaded_at", "pk")
        if not attached_only or d.pk in used
    ]


def _release(names) -> None:
    """Deletes stored files once the transaction commits, each only if no record still uses it: a
    file can be shared by a library document and its attachments, and by attachments a submission
    sent."""
    names = {n for n in names if n}
    if not names:
        return
    held = set(EvidenceFile.objects.filter(file__in=names).values_list("file", flat=True))
    held |= set(CaseDocument.objects.filter(file__in=names).values_list("file", flat=True))
    free = sorted(names - held)
    if free:
        transaction.on_commit(lambda: delete_files(free))


def remove_files(evidence) -> None:
    """Takes documents off the questions they are attached to. An attachment a submission already
    sent to the engine is kept and only marked superseded, so the record stays whole; the others go.
    The file itself stays while the library (or anything else) still holds it, so a detached
    document is back in "Your documents"; a file nothing holds is deleted once the transaction
    commits."""
    evidence = list(evidence)
    sent = set(
        EvidenceFile.submissions.through.objects.filter(evidencefile_id__in=[e.pk for e in evidence])
        .values_list("evidencefile_id", flat=True)
    )
    kept = [e.pk for e in evidence if e.pk in sent]
    gone = [e for e in evidence if e.pk not in sent]
    EvidenceFile.objects.filter(pk__in=kept).update(superseded_at=timezone.now())
    EvidenceFile.objects.filter(pk__in=[e.pk for e in gone]).delete()
    _release(e.file.name for e in gone)


def remove_documents(documents) -> None:
    """Deletes library documents: off every question first, then their files, unless a record a
    submission sent still uses one. A supporting document only backs up the primary it was attached
    with, so a question losing its primary loses its supporting document too (it stays in the
    library)."""
    documents = list(documents)
    if not documents:
        return
    attached = EvidenceFile.objects.filter(document__in=documents, superseded_at__isnull=True)
    lost_primary = attached.exclude(role=EvidenceRole.SUPPORTING).values_list("assessment_id", "qid")
    taken = Q(pk__in=attached)
    for assessment_id, qid in set(lost_primary):
        taken |= Q(assessment_id=assessment_id, qid=qid)
    remove_files(EvidenceFile.objects.filter(taken, superseded_at__isnull=True))
    names = [d.file.name for d in documents]
    CaseDocument.objects.filter(pk__in=[d.pk for d in documents]).delete()
    _release(names)


def require_library_open(assessment: Assessment) -> None:
    """The library takes documents while the applicant can still attach them: before submission,
    and while the case is back with them for new evidence."""
    if assessment.stage not in (Stage.NOT_SUBMITTED, Stage.AWAITING_APPLICANT):
        raise Conflict("Documents can no longer be added: the application has been submitted.")


def receive_document(assessment: Assessment, upload, user, allowed: list[str], accepts: str) -> CaseDocument:
    """Checks an uploaded file (format against `allowed`, size, contents) and stores it, without
    adding it to the library yet: that is `keep_document`'s, once the form is locked. `accepts`
    begins the message for a refused format ("This question accepts", "Upload"). The caller deletes
    the stored file with `discard_received` unless it was kept."""
    try:
        _, content_type = validation.evidence_file(upload, allowed, settings.EVIDENCE_MAX_BYTES, accepts=accepts)
    except DjangoValidationError as exc:
        raise ValidationError({"file": exc.messages[0]}) from None
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    document = CaseDocument(
        assessment=assessment,
        original_name=_safe_name(upload.name),
        content_type=content_type,
        size_bytes=upload.size,
        sha256=digest.hexdigest(),
        uploaded_by=user,
    )
    document.file.save("upload", upload, save=False)
    return document


def keep_document(received: CaseDocument, limit: int, full: str) -> tuple[CaseDocument, bool]:
    """With the form locked: puts a received file in the library. The same contents already there
    are that document instead. Returns (document, created); `full` is the refusal once the library
    holds `limit` documents."""
    library = received.assessment.library
    existing = library.filter(sha256=received.sha256).first()
    if existing is not None:
        return existing, False
    if library.count() >= limit:
        raise ValidationError({"file": full})
    received.save()
    return received, True


def discard_received(received: CaseDocument) -> None:
    """Deletes the stored file of a received upload that did not go into the library."""
    if received.file.name:
        delete_files([received.file.name])


class Received:
    """Around the locked block that keeps a received upload (or around nothing, for None): unless
    `kept` is set once that block has committed, its stored file is deleted on the way out, whether
    it was refused, rolled back, or its contents were already in the library."""

    def __init__(self, document: CaseDocument | None):
        self.document = document
        self.kept = False

    def __enter__(self) -> "Received":
        return self

    def __exit__(self, *exc_info) -> bool:
        if self.document is not None and not self.kept:
            discard_received(self.document)
        return False


def library_limit(assessment: Assessment, questions: dict | None = None) -> int:
    """The most documents the application's library holds, however they come in (uploaded there or
    at a question): a place for every document the form can take, plus EVIDENCE_LIBRARY_MAX_FILES
    spare (documents replaced at a question stay in it). One limit, so the library is never over it;
    one attached nowhere can always be removed to make room. Pass the form's questions if loaded."""
    if questions is None:
        questions = catalogue.questions(catalogue.version_for(assessment).pk)
    return settings.EVIDENCE_LIBRARY_MAX_FILES + sum(q.max_files for q in questions.values()) + 1


def _library_full(limit: int) -> str:
    return f"Your documents hold at most {limit} files. Remove one you no longer need, then upload this one."


def _stream(stored, content_type: str, name: str, what: str):
    """Sends a stored file back as a download, never cached. A record whose file is gone (storage
    cleaned up by hand, or a move that missed it) is, for the person asking, not there."""
    try:
        handle = stored.open("rb")
    except FileNotFoundError:
        logger.error("%s is missing from storage", what)
        raise Http404 from None
    response = FileResponse(handle, content_type=content_type, filename=name)
    response["Cache-Control"] = "private, no-store"
    return response


def require_can_change(assessment: Assessment, qid: str) -> None:
    """Documents change freely before submission. Afterwards, only while the case is back with the
    applicant, and only for the answers the reviewer rejected."""
    if assessment.stage == Stage.NOT_SUBMITTED:
        return
    if qid not in workflow.rejected_qids(assessment):
        raise Conflict("Documents can only be changed for the answers the reviewer sent back.")


def _safe_name(name: str) -> str:
    """The uploaded name, reduced to a plain file name for display and the download header."""
    name = os.path.basename(name.replace("\\", "/")).strip() or "document"
    return "".join(ch for ch in name if ch.isprintable() and ch not in '"<>|:*?')[:255]


class EvidenceUploadView(APIView):
    """Attach one document to a question (or the CV): a new file, which also goes into the
    application's library, or a document already there (documentId). Multipart fields: file or
    documentId, qid, optionCode, role (primary|supporting), description (required for "Other")."""

    parser_classes = [MultiPartParser]
    throttle_scope = "upload"

    def post(self, request, public_id):
        assessment = assessment_for(request.user, public_id, queryset=Assessment.objects.select_related("applicant"))
        require_owner(request.user, assessment)

        upload = request.FILES.get("file")
        document_id = (request.data.get("documentId") or "").strip()
        qid = (request.data.get("qid") or "").strip()
        code = (request.data.get("optionCode") or "").strip()
        role = (request.data.get("role") or EvidenceRole.PRIMARY).strip()
        description = (request.data.get("description") or "").strip()[:200]
        if upload is None and not document_id:
            raise ValidationError({"file": "Choose a file to upload."})
        if role not in EvidenceRole.values:
            raise ValidationError({"role": "Unknown role."})
        require_can_change(assessment, qid)

        if qid == catalogue.CV_QID:
            allowed, max_files = CV_FILE_TYPES, 1
        else:
            questions = catalogue.questions(catalogue.version_for(assessment).pk)
            question = questions.get(qid)
            if question is None:
                raise ValidationError({"qid": "Unknown question."})
            _require_takes_document(assessment, questions, qid)
            allowed, max_files = question.file_types, question.max_files

        try:
            option = catalogue.option(qid, code, None if qid == catalogue.CV_QID else question)
        except EngineUnavailable:
            raise ServiceUnavailable() from None
        if option is None:
            raise ValidationError({"optionCode": "Choose a document type from the list."})
        if option["code"] == "OTHER" and not description:
            raise ValidationError({"description": "Describe the document you are attaching."})
        if catalogue.custom_name(option["code"]) and not description:
            # A document type the reviewer named: its name says what the document is.
            description = option["label"][:200]

        current = EvidenceFile.objects.filter(assessment=assessment, qid=qid, superseded_at__isnull=True)
        if role == EvidenceRole.SUPPORTING:
            if max_files < 2:
                raise ValidationError({"role": "This question takes a single document."})
            if not current.filter(role=EvidenceRole.PRIMARY).exists():
                raise ValidationError({"role": "Attach the main document first."})

        received = None
        if document_id:
            # One already in the library: it must be in a format this question takes.
            chosen = assessment.library.filter(public_id=document_id).first() if _is_uuid(document_id) else None
            if chosen is None:
                raise ValidationError({"documentId": "That document is no longer in your documents."})
            if not validation.format_allowed(chosen.original_name, allowed):
                raise ValidationError({"file": validation.formats_refused(allowed)})
            name, content_type = chosen.original_name, chosen.content_type
        else:
            # A new file: checked against this question's formats and stored now (it may take a
            # while); it goes into the library below, with the form locked.
            received = receive_document(assessment, upload, request.user, allowed, "This question accepts")
            # The attachment keeps the name it was uploaded with, even when the same contents are
            # already in the library under another.
            name, content_type = received.original_name, received.content_type

        created = False
        with Received(received) as incoming:
            with transaction.atomic():
                require_can_change(lock(assessment), qid)
                if qid != catalogue.CV_QID:
                    _still_takes(assessment, qid, option["code"], name, role)
                if received is not None:
                    limit = library_limit(assessment)
                    document, created = keep_document(received, limit, _library_full(limit))
                else:
                    # Read again under the lock: a removal from the library waits on it, so the
                    # document is either still there or already gone.
                    document = assessment.library.filter(pk=chosen.pk).first()
                    if document is None:
                        raise ValidationError({"documentId": "That document is no longer in your documents."})
                if role == EvidenceRole.SUPPORTING and current.filter(role=EvidenceRole.PRIMARY, sha256=document.sha256).exists():
                    # A supporting document is checked against the main one: the same file twice
                    # would only be checked against itself.
                    raise ValidationError({"file": "That document is already this question's main document."})
                evidence = EvidenceFile(
                    assessment=assessment,
                    document=document,
                    qid=qid,
                    option_code=option["code"],
                    doc_type=option["doc_type"],
                    role=role,
                    description=description,
                    original_name=name,
                    content_type=content_type,
                    size_bytes=document.size_bytes,
                    sha256=document.sha256,
                    uploaded_by=request.user,
                )
                # The attachment shares the library document's stored file.
                evidence.file.name = document.file.name
                # A new document for the same slot replaces the old one. A supporting document only
                # backs up the primary it was attached with, so a new primary replaces both.
                remove_files(current if role == EvidenceRole.PRIMARY else current.filter(role=role))
                evidence.save()
                assessment.save(update_fields=["updated_at"])
                audit.record(
                    request.user, "evidence.upload", assessment_ref=assessment.public_id,
                    target_type="evidence", target_id=evidence.public_id,
                    metadata={"qid": qid, "role": role, "document": str(document.public_id)},
                )
            # Committed: a file new to the library stays.
            incoming.kept = created
        return Response(evidence_payload(assessment, evidence), status=status.HTTP_201_CREATED)


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


def _require_takes_document(assessment: Assessment, questions: dict, qid: str) -> None:
    """Refuses a document for a question the form does not ask (a follow-up its parent's answer
    does not call for) or whose current answer needs none."""
    saved = dict(AnswerValue.objects.filter(assessment=assessment).values_list("qid", "value"))
    answers = catalogue.with_defaults(questions, saved)
    if qid not in catalogue.asked(questions, answers):
        raise ValidationError({"qid": "This follow-up question is not asked for the current answers."})
    if not catalogue.evidence_required(questions[qid], answers[qid]):
        raise ValidationError({"qid": "The current answer to this question does not need a document."})


def _still_takes(assessment: Assessment, qid: str, code: str, name: str, role: str) -> None:
    """With the form locked, whether the question as now published still takes this document: the
    settings may have been published anew while the file was being received (a publish locks the
    drafts it changes, so it has either finished or waits for this upload)."""
    questions = catalogue.questions(catalogue.version_for(assessment).pk)
    question = questions.get(qid)
    if question is None:
        raise ValidationError({"qid": "This question is no longer on the form."})
    _require_takes_document(assessment, questions, qid)
    if catalogue.option(qid, code, question) is None:
        raise ValidationError({"optionCode": "Choose a document type from the list."})
    if not validation.format_allowed(name, question.file_types):
        raise ValidationError({"file": validation.formats_refused(question.file_types)})
    if role == EvidenceRole.SUPPORTING and question.max_files < 2:
        raise ValidationError({"role": "This question takes a single document."})


class EvidenceDetailView(APIView):
    """DELETE: takes a document off its question. It stays in the application's library."""

    def delete(self, request, public_id, evidence_id):
        assessment = assessment_for(request.user, public_id)
        require_owner(request.user, assessment)
        evidence = assessment.evidence.filter(public_id=evidence_id, superseded_at__isnull=True).first()
        if evidence is None:
            raise Http404
        require_can_change(assessment, evidence.qid)
        with transaction.atomic():
            require_can_change(lock(assessment), evidence.qid)
            removed = assessment.evidence.filter(qid=evidence.qid, superseded_at__isnull=True)
            # A supporting document only exists to be checked against the primary, so removing the
            # primary takes it too.
            if evidence.role == EvidenceRole.SUPPORTING:
                removed = removed.filter(pk=evidence.pk)
            remove_files(removed)
            assessment.save(update_fields=["updated_at"])
            audit.record(
                request.user, "evidence.remove", assessment_ref=assessment.public_id,
                target_type="evidence", target_id=evidence.public_id, metadata={"qid": evidence.qid},
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class EvidenceFileView(APIView):
    """Streams one document back to the applicant who owns it or the reviewer."""

    def get(self, request, public_id, evidence_id):
        assessment = assessment_for(request.user, public_id)
        evidence = assessment.evidence.filter(public_id=evidence_id).first()
        if evidence is None:
            raise Http404
        return _stream(
            evidence.file, evidence.content_type, evidence.original_name,
            f"Evidence {evidence.public_id} of {assessment.public_id}",
        )


# ---- The application's library ("Your documents") -----------------------------------------------

class DocumentListView(APIView):
    """POST (the applicant): upload one file to the application's library, to attach to questions
    later. Multipart field: file. The same file uploaded again returns the document already there
    (200, duplicate: true) rather than a second copy."""

    parser_classes = [MultiPartParser]
    throttle_scope = "upload"

    def post(self, request, public_id):
        assessment = assessment_for(request.user, public_id, queryset=Assessment.objects.select_related("applicant"))
        require_owner(request.user, assessment)
        require_library_open(assessment)
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Choose a file to upload."})
        # Said for the library, not for one question.
        received = receive_document(assessment, upload, request.user, LIBRARY_FILE_TYPES, "Upload")
        with Received(received) as incoming:
            with transaction.atomic():
                # Checked again with the form locked: a submit at the same moment closes the library.
                require_library_open(lock(assessment))
                limit = library_limit(assessment)
                document, created = keep_document(received, limit, _library_full(limit))
                if created:
                    assessment.save(update_fields=["updated_at"])
                    audit.record(
                        request.user, "document.upload", assessment_ref=assessment.public_id,
                        target_type="document", target_id=document.public_id,
                    )
            incoming.kept = created
        used = used_by(document.attachments.filter(superseded_at__isnull=True))
        return Response(
            {**document_payload(assessment, document, used), "duplicate": not created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class DocumentDetailView(APIView):
    """DELETE (the applicant): removes a document from the library, and from every question it is
    attached to."""

    def delete(self, request, public_id, document_id):
        assessment = assessment_for(request.user, public_id)
        require_owner(request.user, assessment)
        document = assessment.library.filter(public_id=document_id).first()
        if document is None:
            raise Http404
        require_library_open(assessment)
        with transaction.atomic():
            locked = lock(assessment)
            require_library_open(locked)
            # Back with the applicant, only answers the reviewer sent back may change.
            for qid in set(document.attachments.filter(superseded_at__isnull=True).values_list("qid", flat=True)):
                require_can_change(locked, qid)
            remove_documents([document])
            assessment.save(update_fields=["updated_at"])
            audit.record(
                request.user, "document.remove", assessment_ref=assessment.public_id,
                target_type="document", target_id=document.public_id,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentFileView(APIView):
    """Streams one library document back to the applicant who owns it, or to the reviewer once it is
    attached to a question (now or in a submission): one attached nowhere is not part of the
    application, and only its owner sees it."""

    def get(self, request, public_id, document_id):
        assessment = assessment_for(request.user, public_id)
        document = assessment.library.filter(public_id=document_id).first()
        if document is None:
            raise Http404
        if request.user.id != assessment.applicant_id and not document.attachments.exists():
            raise Http404
        return _stream(
            document.file, document.content_type, document.original_name,
            f"Document {document.public_id} of {assessment.public_id}",
        )

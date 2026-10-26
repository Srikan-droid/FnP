from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from engine.client import EngineUnavailable

from .. import audit, catalogue
from ..models import (
    AnswerType, AnswerValue, ApplicantProfile, Assessment, EvidenceFile, EvidenceRule, Stage, TEXT_ANSWER_MAX,
)
from ..permissions import assessment_for
from .common import lock, require_editable, require_owner
from .evidence import (
    LIBRARY_FILE_TYPES,
    evidence_payload,
    library_limit,
    library_payload,
    remove_documents,
    remove_files,
)

def _own_options(questions: dict) -> dict[str, list[dict]]:
    """The document types this form's version gives its questions, where the catalogue (which lists
    the latest version's) may differ: those chosen here for a question, and the engine's own list
    for one that follows it in this version but has others chosen in a later one. Left out if the
    engine cannot be reached: the catalogue's copy is then used."""
    chosen = {qid: q.evidence_options for qid, q in questions.items() if q.evidence_options}
    later = catalogue.chosen_codes()
    following = [
        qid for qid, q in questions.items()
        if not q.evidence_options and q.evidence_required != EvidenceRule.NEVER and qid in later
    ]
    if not chosen and not following:
        return {}
    by_code: dict[str, dict] = {}
    engine_lists: dict[str, list[dict]] = {}
    try:
        if following:
            engine_lists = {qid: catalogue.evidence_options().get(qid, []) for qid in following}
        if any(catalogue.custom_name(c) is None for codes in chosen.values() for c in codes):
            by_code = catalogue.options_by_code()
    except EngineUnavailable:
        # Only the names typed in here can be given; the rest come from the catalogue's copy.
        chosen = {qid: codes for qid, codes in chosen.items() if all(catalogue.custom_name(c) for c in codes)}
    return {
        **engine_lists,
        **{qid: catalogue.chosen_options(codes, by_code) for qid, codes in chosen.items()},
    }


def form_payload(assessment: Assessment, viewer) -> dict:
    """The form as the applicant fills it in. A question with no saved answer reads "No", which is
    what a blank form starts from. `viewer`: who reads it; anyone but the applicant sees only the
    documents attached to a question."""
    version = catalogue.version_for(assessment)
    questions = catalogue.questions(version.pk)
    saved = dict(assessment.answers.values_list("qid", "value"))
    own = _own_options(questions)
    evidence = list(
        assessment.evidence.filter(superseded_at__isnull=True).select_related("document").order_by("uploaded_at")
    )
    return {
        "locked": assessment.stage != Stage.NOT_SUBMITTED,
        # The questionnaire edition the form is on: a page holding an older copy of the questions
        # (its department changed them meanwhile) reads them again.
        "version": version.label,
        # Personal details (date of birth, ID number and the like) are not collected or shown.
        "applicant": {
            "fullName": assessment.applicant_name,
            "email": assessment.applicant.email,
            "proposedRole": assessment.position,
        },
        "answers": [
            {
                "qid": qid,
                "value": saved.get(qid, catalogue.default_answer(q)),
                "answerType": q.answer_type,
                "evidenceRequired": catalogue.evidence_required(q, saved.get(qid, catalogue.default_answer(q))),
                # The rule behind it ("always" or "if_yes"), so the form can follow a changed answer
                # at once without reading the rule from the active catalogue (maybe another version).
                "evidenceRule": q.evidence_required,
                # The rules this form is checked against, from the assessment's version.
                "allowedAnswers": q.allowed_answers,
                "fileTypes": q.file_types,
                "maxFiles": q.max_files,
                # For a question added here: the document types as this form's version gives them
                # (the catalogue lists the latest version's), so the picker offers what an upload
                # is checked against. Null otherwise: the engine's own list applies.
                "evidenceOptions": own.get(qid),
            }
            for qid, q in questions.items()
        ],
        "evidence": [evidence_payload(assessment, e) for e in evidence],
        # "Your documents": everything uploaded, each with the questions it is attached to now.
        "documents": library_payload(assessment, evidence, attached_only=viewer.id != assessment.applicant_id),
        "documentsMax": library_limit(assessment, questions),
        # The formats "Your documents" takes, as the upload there checks them.
        "documentsFileTypes": LIBRARY_FILE_TYPES,
    }


def _validated_answers(body: dict, questions: dict) -> dict:
    """Checks every submitted answer and returns those to save, or raises one ValidationError
    listing every problem, so a partly valid body changes nothing."""
    if "applicant" in body:
        # Personal details are no longer collected; nothing here stores them.
        raise ValidationError({"applicant": "Applicant details are not collected."})
    errors: dict[str, str] = {}
    answers: dict[str, str] = {}
    raw_answers = body.get("answers") or {}
    if not isinstance(raw_answers, dict):
        raise ValidationError({"detail": "answers must be an object."})
    for qid, value in raw_answers.items():
        question = questions.get(qid)
        if question is None:
            errors[f"answers.{qid}"] = "Unknown question."
        elif question.answer_type == AnswerType.TEXT:
            if not isinstance(value, str):
                errors[f"answers.{qid}"] = "Enter the answer as text."
            elif "\x00" in value or any(0xD800 <= ord(c) <= 0xDFFF for c in value):
                errors[f"answers.{qid}"] = "The answer contains a character that cannot be saved."
            elif len(value.strip()) > TEXT_ANSWER_MAX:
                errors[f"answers.{qid}"] = f"Keep the answer to {TEXT_ANSWER_MAX} characters."
            else:
                answers[qid] = value.strip()
        elif value not in question.allowed_answers:
            errors[f"answers.{qid}"] = f"Choose one of {', '.join(question.allowed_answers)}."
        else:
            answers[qid] = value
    if errors:
        raise ValidationError(errors)
    return answers


class FormView(APIView):
    """GET: the form (applicant or reviewer). PATCH (applicant, before submission): save answers
    answers: {"answers": {"A1": "Yes"}}."""

    def _assessment(self, request, public_id):
        return assessment_for(request.user, public_id, queryset=Assessment.objects.select_related("applicant"))

    def get(self, request, public_id):
        return Response(form_payload(self._assessment(request, public_id), request.user))

    def patch(self, request, public_id):
        assessment = self._assessment(request, public_id)
        require_owner(request.user, assessment)
        require_editable(assessment)
        if not isinstance(request.data, dict):
            raise ValidationError("Expected an object.")
        version_id = catalogue.version_for(assessment).pk
        questions = catalogue.questions(version_id)
        answers = _validated_answers(request.data, questions)

        with transaction.atomic():
            require_editable(lock(assessment))
            # The settings may have been published anew while this request was on its way; with
            # the form locked (a publish locks the drafts it changes) they are checked once more.
            if catalogue.version_for(assessment).pk != version_id:
                questions = catalogue.questions(catalogue.version_for(assessment).pk)
                answers = _validated_answers(request.data, questions)
            for qid, value in answers.items():
                AnswerValue.objects.update_or_create(assessment=assessment, qid=qid, defaults={"value": value})
            # A document only exists to support an answer that needs one; drop it the moment the
            # answer stops needing it.
            no_longer_needed = [
                qid for qid, value in answers.items() if not catalogue.evidence_required(questions[qid], value)
            ]
            if no_longer_needed:
                remove_files(EvidenceFile.objects.filter(assessment=assessment, qid__in=no_longer_needed))
            assessment.save(update_fields=["updated_at"])
        return Response(form_payload(assessment, request.user))


class FormResetView(APIView):
    """Starts the form over (applicant, before submission): answers, details and documents."""

    def post(self, request, public_id):
        assessment = assessment_for(request.user, public_id, queryset=Assessment.objects.select_related("applicant"))
        require_owner(request.user, assessment)
        require_editable(assessment)
        with transaction.atomic():
            require_editable(lock(assessment))
            assessment.answers.all().delete()
            ApplicantProfile.objects.filter(pk=assessment.pk).delete()
            # Starting over clears "Your documents", and every document attached from it; then any
            # attached before the library existed (in none).
            remove_documents(assessment.library.all())
            remove_files(assessment.evidence.filter(document__isnull=True))
            assessment.save(update_fields=["updated_at"])
            audit.record(request.user, "form.reset", assessment_ref=assessment.public_id)
        return Response(form_payload(assessment, request.user), status=status.HTTP_200_OK)

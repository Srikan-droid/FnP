import base64
import datetime
import re

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models import (
    BooleanField,
    Count,
    Exists,
    OuterRef,
    Prefetch,
    Q,
    QuerySet,
    Subquery,
)
from django.db.models.expressions import RawSQL
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import audit, catalogue, prefill, validation, workflow
from ..models import (
    AnswerType,
    AnswerValue,
    ApplicantProfile,
    Assessment,
    CaseDocument,
    Decision,
    Department,
    EvidenceFile,
    QuestionResult,
    ResultStatus,
    Role,
    Ruling,
    Score,
    Stage,
    Submission,
    User,
    Verdict,
)
from ..permissions import assessment_for, may_manage, visible_assessments
from ..storage import delete_files
from .common import Conflict, holder_payload, lock

PAGE_SIZE = 50
# Applications an applicant may have started and not yet submitted at one time.
MAX_OPEN_DRAFTS = 3
# Running cases one list request follows, so a slow engine delays a list by one run at most. The
# rest are picked up by the next poll, a few seconds on.
SYNC_PER_REQUEST = 1

# Stages the reviewer has to act on (frontend: needsReviewer).
NEEDS_REVIEWER = [Stage.REVIEW_PENDING, Stage.DECISION_PENDING, Stage.AUTH_FAILED]
# Groups the queue's status filter offers besides each single stage (?stage=NEEDS_ACTION, say).
STAGE_GROUPS = {
    "NEEDS_ACTION": NEEDS_REVIEWER,
    "IN_PROGRESS": [Stage.AUTH_RUNNING, Stage.SCORING],
    "DECIDED": [Stage.ACCEPTED, Stage.REJECTED],
}
# Longest search text accepted (a name, reference, case id or email).
SEARCH_MAX = 100


def _stages(value: str | None) -> list[str] | None:
    """The stages a ?stage= asks for: one stage, a group, or None for no filter."""
    if not value:
        return None
    if value in STAGE_GROUPS:
        return list(STAGE_GROUPS[value])
    if value in Stage.values:
        return [value]
    raise ValidationError({"stage": "Unknown stage."})


def document_progress(drafts: list[Assessment]) -> dict[int, dict]:
    """For forms not submitted yet (by pk): how many of the documents each needs are attached, by
    the rule submitting checks (workflow.documents_needed). A fixed number of queries, however many
    drafts: drafts are held to their department's settings in force, so those are read once each."""
    if not drafts:
        return {}
    versions = catalogue.active_versions(a.department_id for a in drafts)
    saved: dict[int, dict[str, str]] = {}
    for pk, qid, value in AnswerValue.objects.filter(assessment__in=drafts).values_list("assessment_id", "qid", "value"):
        saved.setdefault(pk, {})[qid] = value
    attached: dict[int, set[str]] = {}
    for pk, qid in EvidenceFile.objects.filter(assessment__in=drafts, superseded_at__isnull=True).values_list(
        "assessment_id", "qid"
    ):
        attached.setdefault(pk, set()).add(qid)
    progress = {}
    for a in drafts:
        questions = catalogue.questions(versions[a.department_id].pk)
        # An answer not saved yet reads as the form starts it (No, or nothing for a text question).
        answers = {qid: saved.get(a.pk, {}).get(qid, catalogue.default_answer(q)) for qid, q in questions.items()}
        needed = workflow.documents_needed(questions, answers)
        have = attached.get(a.pk, set())
        progress[a.pk] = {
            "documentsNeeded": len(needed),
            "documentsAttached": sum(1 for qid in needed if qid in have),
            # Questions answered in words still blank: submitting waits for them too.
            "answersMissing": sum(
                1 for qid, q in questions.items() if q.answer_type == AnswerType.TEXT and not answers[qid].strip()
            ),
        }
    return progress


def with_queue_summary(qs):
    """Loads what the queue cards show about each assessment's latest run in a fixed number of
    queries, however many assessments are listed: the runs, their flags, their rulings, and the
    decision. Only each assessment's latest run is loaded: that is the one the card describes."""
    latest_attempt = Subquery(
        Submission.objects.filter(assessment=OuterRef("assessment")).order_by("-attempt_no").values("attempt_no")[:1]
    )
    started = (
        Exists(AnswerValue.objects.filter(assessment=OuterRef("pk")))
        | Exists(EvidenceFile.objects.filter(assessment=OuterRef("pk")))
        | Exists(ApplicantProfile.objects.filter(assessment=OuterRef("pk")))
        # Documents uploaded to "Your documents" first, before any answer: started too.
        | Exists(CaseDocument.objects.filter(assessment=OuterRef("pk")))
    )
    return qs.annotate(has_draft=started).select_related("department", "applicant", "decision", "reviewer").prefetch_related(
        Prefetch(
            "submissions",
            # Only what the queue card needs: never the payload sent to the engine.
            queryset=Submission.objects.only("id", "assessment_id", "attempt_no")
            .filter(attempt_no=latest_attempt)
            .prefetch_related(
                Prefetch("question_results", queryset=QuestionResult.objects.filter(status=ResultStatus.ISSUE),
                         to_attr="issues"),
                "rulings",
            ),
            to_attr="runs",
        )
    )


def _queue_summary(a: Assessment) -> dict:
    runs = getattr(a, "runs", None)
    if runs is None:  # a single assessment loaded without the prefetch
        return _queue_summary(with_queue_summary(Assessment.objects.filter(pk=a.pk)).get())
    latest = runs[0] if runs else None
    flagged = [r.qid for r in latest.issues] if latest else []
    verdicts = {r.qid: r.verdict for r in latest.rulings.all()} if latest else {}
    decision = getattr(a, "decision", None)
    return {
        "flagged": flagged,
        "openFlags": len([q for q in flagged if q not in verdicts]),
        "rejected": sorted(q for q, v in verdicts.items() if v == Verdict.REJECTED),
        "decisionRemarks": decision.remarks if decision else None,
    }


def _held_by_other(user: User, a: Assessment) -> bool:
    """Another admin has taken the case: only they, or the super user, act on it."""
    return a.reviewer_id is not None and a.reviewer_id != user.pk and not user.is_super_user


def removable_by(user: User, a: Assessment) -> bool:
    """An admin may remove any assessment of their departments, at any stage, except while the AI
    engine is working on it (a run being sent or followed would lose its case) or while another
    admin has taken it; the super user any of them. An applicant may remove only one they started
    themselves, before submission, and never a built-in demo one."""
    if user.is_reviewer:
        return a.stage not in workflow.FOLLOWED_STAGES and not _held_by_other(user, a)
    return a.stage == Stage.NOT_SUBMITTED and a.created_by_id == user.id


def assessment_payload(a: Assessment, viewer: User) -> dict:
    payload = {
        "id": a.public_id,
        "applicantName": a.applicant_name,
        "applicantEmail": a.applicant.email,
        "department": {"key": a.department.key, "name": a.department.name, "blurb": a.department.blurb},
        "entity": a.entity,
        "position": a.position,
        "reference": a.parent_reference,
        "initiatedOn": a.initiated_on.isoformat(),
        "stage": a.stage,
        "submittedAt": a.submitted_at,
        "decidedAt": a.decided_at,
        "updatedAt": a.updated_at,
        # When the case reached its stage: how long it has waited there.
        "stageSince": a.stage_changed_at,
        "removable": removable_by(viewer, a),
        # The viewer's own application: a reviewer never rules on or decides it.
        "ownApplication": a.applicant_id == viewer.id,
        # Started by the applicant themselves, rather than opened for them by the reviewer.
        "startedByApplicant": a.created_by_id == a.applicant_id,
        # Whether the applicant has saved anything yet (the list shows "Draft saved").
        "hasDraft": a.has_draft,
        "queue": _queue_summary(a),
    }
    if viewer.is_reviewer:
        # Which of the department's admins is reviewing it (the queue card says; null: not taken).
        payload["reviewer"] = holder_payload(a)
    return payload


def _encode_cursor(a: Assessment) -> str:
    return base64.urlsafe_b64encode(f"{a.updated_at.isoformat()}|{a.pk}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime.datetime, int]:
    try:
        stamp, pk = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        moment = datetime.datetime.fromisoformat(stamp)
        if moment.tzinfo is None:
            raise ValueError("cursor time without a zone")
        # Normalised here so an out-of-range offset fails as a bad cursor, not in the database.
        return moment.astimezone(datetime.UTC), int(pk)
    except (ValueError, UnicodeDecodeError, OverflowError):
        raise ValidationError({"cursor": "Invalid cursor."}) from None


def _follow_running(visible: QuerySet | None) -> None:
    """The list is polled while a case is running. When no background worker is following the
    engine, it moves a few of the listed runs on itself; with a worker, none is ever due, and this
    is a single indexed lookup."""
    if settings.ENGINE_FOLLOW_IN_REQUESTS:
        workflow.follow_due_runs(SYNC_PER_REQUEST, assessments=visible)


class NewAssessmentSerializer(serializers.Serializer):
    """What an applicant gives to start their own application. Their email is their sign-in, and
    it is initiated today."""

    applicantName = serializers.CharField(max_length=200)
    entity = serializers.CharField(max_length=200)
    position = serializers.CharField(max_length=200)
    reference = serializers.CharField(max_length=40)
    department = serializers.CharField(max_length=32)

    def validate_department(self, value):
        department = Department.objects.filter(key=value).first()
        if department is None:
            raise serializers.ValidationError("Choose a department from the list.")
        # A department switched off takes no new applications, nor one with no questions yet.
        if not department.is_active:
            raise serializers.ValidationError(f"{department.name} is not taking new applications at the moment.")
        if not catalogue.has_questions(department):
            raise serializers.ValidationError(f"{department.name} is not taking applications yet: it has no questions.")
        return department

    def validate_reference(self, value):
        if Assessment.objects.filter(parent_reference__iexact=value).exists():
            raise serializers.ValidationError("An assessment already exists for this application reference.")
        return value


class ReviewerNewAssessmentSerializer(NewAssessmentSerializer):
    """The reviewer opens one for an applicant, naming them by email, with the date it was initiated."""

    email = serializers.CharField(max_length=254)
    initiatedOn = serializers.DateField()

    def validate_email(self, value):
        try:
            return validation.applicant_email(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from None

    def validate_initiatedOn(self, value):
        try:
            return validation.initiated_on(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from None


class AssessmentListView(APIView):
    """GET: an applicant's own assessments, newest activity first; or for the reviewer the queue of
    submitted assessments (optionally one stage and/or one department), the one acted on most
    recently first, keyset-paginated, with the queue's totals across every page. POST: the reviewer
    opens an assessment for an applicant, or an applicant starts their own."""

    def get_throttles(self):
        # Opening assessments is rate limited; listing them (polled while engines run) is not.
        if self.request.method == "POST":
            self.throttle_scope = "create"
        return super().get_throttles()

    def get(self, request):
        # Everything for the super user, an admin's departments, an applicant's own.
        visible = visible_assessments(request.user)
        if not request.query_params.get("cursor"):
            # The super user sees every assessment, so their runs need no narrowing.
            _follow_running(None if request.user.is_super_user else visible)
        if not request.user.is_reviewer:
            items = list(with_queue_summary(visible).order_by("-updated_at", "-id"))
            progress = document_progress([a for a in items if a.stage == Stage.NOT_SUBMITTED])
            results = []
            for a in items:
                payload = assessment_payload(a, request.user)
                if a.pk in progress:
                    payload["progress"] = progress[a.pk]
                results.append(payload)
            return Response({"results": results, "next": None})

        # The reviewer's queue holds what applicants have submitted: a form still being filled in
        # (started by the applicant, or opened by the reviewer and not sent yet) joins it on its first
        # submission and stays there. Those not submitted yet are listed only when asked for
        # (?stage=NOT_SUBMITTED), so the reviewer can still find, and remove, one they opened.
        stages = _stages(request.query_params.get("stage"))
        department = request.query_params.get("department")
        if department:
            if not Department.objects.filter(key=department).exists():
                raise ValidationError({"department": "Unknown department."})
            visible = visible.filter(department__key=department)
        holder = request.query_params.get("holder")
        if holder == "mine":
            visible = visible.filter(reviewer=request.user)
        elif holder == "none":
            visible = visible.filter(reviewer__isnull=True)
        elif holder:
            raise ValidationError({"holder": "Choose mine or none."})
        search = (request.query_params.get("q") or "").strip()[:SEARCH_MAX]
        if search:
            visible = visible.filter(
                Q(applicant_name__icontains=search) | Q(parent_reference__icontains=search)
                | Q(public_id__icontains=search) | Q(applicant__email__icontains=search)
            )
        cursor = request.query_params.get("cursor")
        # The queue's counts come with its first page only: "Show more" adds rows, not new counts.
        # The count of each stage among what the department and search leave, whatever the status
        # filter: the queue's summary tiles, each a way into that part of the queue.
        # With them, per stage, how many wait on this reviewer: theirs or nobody's yet (another
        # admin's wait on that admin; the super user too acts on those only by taking them over).
        counted = None if cursor else list(
            visible.order_by().values("stage").annotate(
                n=Count("pk"), on_me=Count("pk", filter=Q(reviewer__isnull=True) | Q(reviewer=request.user))
            )
        )
        stage_counts = None if counted is None else {row["stage"]: row["n"] for row in counted}
        if stages is None or Stage.NOT_SUBMITTED not in stages:
            visible = visible.exclude(stage=Stage.NOT_SUBMITTED)
        if stages:
            visible = visible.filter(stage__in=stages)
        # The stages listed, as the two filters above leave them.
        shown_stages = {str(s) for s in stages} if stages else set(Stage.values) - {Stage.NOT_SUBMITTED.value}
        # The case acted on most recently first, whatever its stage: any action on it (a submission,
        # a ruling, a decision, the engine finishing) brings it to the top.
        qs = with_queue_summary(visible).order_by("-updated_at", "-id")
        if cursor:
            stamp, pk = _decode_cursor(cursor)
            # A row comparison, so the database starts reading at the cursor rather than reading
            # every earlier row and discarding it.
            after = RawSQL(
                '("assessment"."updated_at", "assessment"."id") < (%s, %s)', (stamp, pk), output_field=BooleanField()
            )
            qs = qs.filter(after)
        page = list(qs[: PAGE_SIZE + 1])
        more = len(page) > PAGE_SIZE
        page = page[:PAGE_SIZE]
        body = {
            "results": [assessment_payload(a, request.user) for a in page],
            "next": _encode_cursor(page[-1]) if more else None,
        }
        if stage_counts is not None:
            # The header's counts cover the whole queue, not just the pages the reviewer has loaded:
            # the cases the status filter leaves, counted from the stage counts already read.
            listed = {st: n for st, n in stage_counts.items() if st in shown_stages}
            actionable = sum(
                row["on_me"] for row in counted if row["stage"] in NEEDS_REVIEWER and row["stage"] in shown_stages
            )
            body.update(total=sum(listed.values()), actionable=actionable, stageCounts=stage_counts)
        return Response(body)

    def post(self, request):
        by_reviewer = request.user.is_reviewer
        data = (ReviewerNewAssessmentSerializer if by_reviewer else NewAssessmentSerializer)(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if by_reviewer:
            if not may_manage(request.user, v["department"]):
                raise ValidationError({"department": "You can open applications only for your own departments."})
            applicant = User.objects.filter(email=v["email"]).first()
            if applicant is not None and applicant.role != Role.APPLICANT:
                raise ValidationError({"email": "This email belongs to a reviewer account."})
            initiated_on = v["initiatedOn"]
        else:
            applicant, initiated_on = request.user, timezone.localdate()
        with transaction.atomic():
            if by_reviewer:
                applicant = applicant or User.objects.get_or_create_for_email(v["email"], Role.APPLICANT)
            else:
                _check_draft_limit(applicant)
            try:
                assessment = _open_assessment(
                    applicant, request.user, initiated_on,
                    applicant_name=v["applicantName"], department=v["department"], entity=v["entity"],
                    position=v["position"], parent_reference=v["reference"],
                )
            except IntegrityError:
                # Two people submitting the same reference at once: the unique index decides.
                raise ValidationError(
                    {"reference": ["An assessment already exists for this application reference."]}
                ) from None
            audit.record(request.user, "assessment.create", assessment_ref=assessment.public_id)
        assessment.has_draft = False  # just opened: nothing saved yet
        return Response(assessment_payload(assessment, request.user), status=status.HTTP_201_CREATED)


def _check_draft_limit(applicant: User) -> None:
    """Refuses a new application from an applicant who already has MAX_OPEN_DRAFTS of their own not
    submitted. Inside a transaction: the applicant's row is locked so two requests at once cannot
    both pass the count."""
    User.objects.select_for_update().get(pk=applicant.pk)
    started = Assessment.objects.filter(applicant=applicant, created_by=applicant, stage=Stage.NOT_SUBMITTED)
    if started.count() >= MAX_OPEN_DRAFTS:
        raise Conflict(
            f"You already have {MAX_OPEN_DRAFTS} applications not yet submitted. "
            "Submit or remove one to start another."
        )


def _open_assessment(applicant: User, created_by: User, initiated_on, **fields) -> Assessment:
    """A new assessment, numbered from the case sequence and held to its department's questions in
    force now."""
    with connection.cursor() as cur:
        cur.execute("SELECT nextval('assessment_serial')")
        serial = cur.fetchone()[0]
    return Assessment.objects.create(
        public_id=f"FNP-{initiated_on.year}-{serial:04d}",
        applicant=applicant,
        initiated_on=initiated_on,
        version=catalogue.active_version(fields["department"]),
        created_by=created_by,
        **fields,
    )


# The applications that can be continued from: decided ones, whose details are settled.
CONTINUABLE = (Stage.ACCEPTED, Stage.REJECTED)
REFERENCE_MAX = Assessment._meta.get_field("parent_reference").max_length


def line_start(source: Assessment) -> Assessment:
    """The first application of a line of continued ones (the source itself if it was not one)."""
    seen = {source.pk}
    while source.continued_from_id is not None and source.continued_from_id not in seen:
        seen.add(source.continued_from_id)
        source = Assessment.objects.get(pk=source.continued_from_id)
    return source


def next_reference(applicant: User, source: Assessment) -> str:
    """A reference for an application continued from `source`: the first of its line's reference
    with a number added, the first one free ("BL-2506" gives "BL-2506-2", then "BL-2506-3", and
    continuing from "BL-2506-2" gives "BL-2506-3"). Which application came from which is stored, so
    a reference that merely ends in a number is never taken for a continued one."""
    return _numbered_reference(applicant, line_start(source).parent_reference)


def _numbered_reference(applicant: User, base: str) -> str:
    """`base` with the first free number added for this applicant ("-2", then "-3" ...), numbered on
    from the ones of theirs already using it."""
    pattern = re.compile(rf"{re.escape(base)}-(\d+)", re.IGNORECASE)
    # Numbered on from the applicant's own continued applications only: another applicant's
    # reference that happens to start the same way ("BL-2506-2025") says nothing about these. A
    # reference taken by anyone is still skipped below, since references are unique.
    taken = Assessment.objects.filter(
        applicant=applicant, parent_reference__istartswith=f"{base}-"
    ).values_list("parent_reference", flat=True)
    used = [int(m[1]) for ref in taken if (m := pattern.fullmatch(ref))]
    number = max([1, *used]) + 1
    while True:
        suffix = f"-{number}"
        candidate = base[: REFERENCE_MAX - len(suffix)] + suffix
        if not Assessment.objects.filter(parent_reference__iexact=candidate).exists():
            return candidate
        number += 1


def free_reference(applicant: User, reference: str) -> str:
    """The reference itself if no application has it yet; otherwise the next free number on it,
    as "Continue with previous" numbers them ("BL-2026-0412" gives "BL-2026-0412-2")."""
    if not Assessment.objects.filter(parent_reference__iexact=reference).exists():
        return reference
    return _numbered_reference(applicant, reference)


class PrefillView(APIView):
    """GET (applicant): the application details on record for the signed-in applicant, to fill in
    "Start a new application" with; null for anyone with none on record. Only the signed-in user's
    own email is looked up. A reference already used is moved on to the next free number, so the
    form never starts with one the server would refuse; a department not taking applications is
    left out, for the applicant to choose."""

    def get(self, request):
        if request.user.is_reviewer:
            raise PermissionDenied("Only an applicant starts their own application.")
        details = prefill.details_for(request.user.email)
        if details is None:
            return Response({"prefill": None})
        # Left for the applicant to choose when that department is switched off or has no
        # questions yet: the form would refuse it.
        department = Department.objects.filter(key=details["department"]).first()
        if department is None or not department.is_active or not catalogue.has_questions(department):
            details["department"] = ""
        details["reference"] = free_reference(request.user, details["reference"])
        return Response({"prefill": details})


class ContinueView(APIView):
    """An applicant starts a new application from a decided one of theirs: the same applicant name,
    department, entity and position, with a reference of its own (next_reference). Only the details
    are carried over; the questions start afresh, under the settings in force now."""

    def get_throttles(self):
        # Opening an application is rate limited, as for POST /assessments.
        self.throttle_scope = "create"
        return super().get_throttles()

    def post(self, request, public_id):
        source = assessment_for(request.user, public_id)
        if request.user.is_reviewer or source.applicant_id != request.user.id:
            raise PermissionDenied("Only the applicant can continue from their own application.")
        if source.stage not in CONTINUABLE:
            raise Conflict("An application can be continued from once a decision has been made on it.")
        if not source.department.is_active:
            raise Conflict(f"{source.department.name} takes no new applications at the moment.")
        if not catalogue.has_questions(source.department):
            raise Conflict(f"{source.department.name} is not taking applications yet: it has no questions.")
        with transaction.atomic():
            _check_draft_limit(request.user)
            for _ in range(5):
                reference = next_reference(request.user, source)
                try:
                    with transaction.atomic():
                        assessment = _open_assessment(
                            request.user, request.user, timezone.localdate(),
                            applicant_name=source.applicant_name, department=source.department,
                            entity=source.entity, position=source.position, parent_reference=reference,
                            continued_from=source,
                        )
                    break
                except IntegrityError:
                    # Another application took that reference at the same moment: take the next one.
                    continue
            else:
                raise Conflict("A reference could not be given to the new application. Try again.")
            audit.record(
                request.user, "assessment.continue", assessment_ref=assessment.public_id,
                metadata={"from": source.public_id},
            )
        assessment.has_draft = False  # just opened: nothing saved yet
        return Response(assessment_payload(assessment, request.user), status=status.HTTP_201_CREATED)


def _removal_record(assessment: Assessment) -> dict:
    """What the audit trail keeps of an assessment removed with its history: whose it was, where it
    stood, the latest engine run and its score, and the decision with the reviewer's remarks, so the
    outcome can still be told once the case is gone."""
    record = {
        "stage": assessment.stage,
        "applicantName": assessment.applicant_name,
        "reference": assessment.parent_reference,
        "department": assessment.department.key,
    }
    run = Submission.objects.filter(assessment=assessment).select_related("score").order_by("-attempt_no").first()
    if run is not None:
        record["latestRun"] = {
            "attempt": run.attempt_no, "requestId": run.engine_request_id, "status": run.status, "outcome": run.outcome,
        }
        score = getattr(run, "score", None)
        if score is not None:
            record["latestRun"]["score"] = {"riskScore": str(score.risk_score), "band": score.band}
    decision = Decision.objects.filter(assessment=assessment).select_related("reviewer").first()
    if decision is not None:
        record["decision"] = {
            "verdict": decision.verdict, "remarks": decision.remarks,
            "decidedAt": decision.decided_at.isoformat(), "reviewer": decision.reviewer.email,
        }
    return record


def _delete_with_history(assessment: Assessment) -> None:
    """Deletes an assessment and everything kept for it: its engine runs (with their documents and
    results), the reviewer's rulings, the score and the decision. These are protected from being
    deleted with it by accident, so they go first, explicitly. The audit trail keeps its entries,
    which name the case by its ID."""
    runs = Submission.objects.filter(assessment=assessment)
    Ruling.objects.filter(submission__in=runs).delete()
    Score.objects.filter(submission__in=runs).delete()
    Decision.objects.filter(assessment=assessment).delete()
    runs.delete()
    assessment.delete()


class AssessmentDetailView(APIView):
    def get(self, request, public_id):
        qs = with_queue_summary(Assessment.objects.all())
        return Response(assessment_payload(assessment_for(request.user, public_id, queryset=qs), request.user))

    def delete(self, request, public_id):
        assessment = assessment_for(request.user, public_id)
        if not request.user.is_reviewer and assessment.created_by_id != request.user.id:
            raise PermissionDenied("Only an application you started yourself can be removed.")
        def refused(a: Assessment) -> str:
            if not request.user.is_reviewer:
                return "Only an assessment that was started here, and not yet submitted, can be removed."
            if _held_by_other(request.user, a):
                return "Another admin is reviewing this assessment. Only they, or the super user, can remove it."
            return "This assessment is with the AI engine right now. Remove it once the run has finished."

        if not removable_by(request.user, assessment):
            raise Conflict(refused(assessment))
        with transaction.atomic():
            # Re-checked on the locked row: a submit, a run starting or an admin taking the case at
            # the same moment must not lose its case.
            row = lock(assessment)
            if not removable_by(request.user, row):
                raise Conflict(refused(row))
            record = _removal_record(row)
            # The files attached and those in "Your documents" (often the same ones).
            files = sorted(
                {e.file.name for e in row.evidence.all()} | {d.file.name for d in row.library.all()}
            )
            _delete_with_history(row)
            audit.record(request.user, "assessment.remove", assessment_ref=public_id, metadata=record)
            transaction.on_commit(lambda: delete_files(files))
        return Response(status=status.HTTP_204_NO_CONTENT)

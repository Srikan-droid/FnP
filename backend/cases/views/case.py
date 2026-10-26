import re

from django.conf import settings
from django.db.models import F, Q, prefetch_related_objects
from django.db.models.fields.json import KeyTextTransform
from django.http import Http404, StreamingHttpResponse
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from engine import client as engine

from .. import adapt, workflow
from ..models import Assessment, Role, Ruling, RunStatus, Stage, Submission, User, Verdict
from ..permissions import IsReviewer, IsSuperUser, assessment_for
from .common import (
    HELD_BY_OTHER, Conflict, ServiceUnavailable, coded_conflict, holder_payload, require_not_own, require_owner,
)

_HIGHLIGHT_NAME = re.compile(r"[A-Za-z0-9._-]{1,120}\.pdf")  # used with fullmatch


def _score_payload(score) -> dict:
    return {
        "source": score.source,
        "riskScore": float(score.risk_score),
        "normalised": float(score.normalised),
        "band": score.band,
        "knockOut": score.knock_out,
        "recommendation": score.recommendation,
        "lines": [
            {
                "qid": line["qid"],
                "section": line["section"],
                "question": line["question"],
                "answer": line["answer"],
                "polarity": line["polarity"],
                "questionWeight": line["question_weight"],
                "riskFlag": line["risk_flag"],
                "applicableWeight": line["applicable_weight"],
                "weightedRisk": line["weighted_risk"],
                "isKnockOut": bool(line["knockout"]),
                "knockOutTriggered": bool(line["knockout_triggered"]),
            }
            for line in score.lines
        ],
    }


def _latest_run(assessment: Assessment):
    """The latest run with what the case page reads from it, loaded together: its documents, its
    score (never the payload sent to the engine, which the page does not show). Its rulings come
    with the case's others, in _rulings_by_run."""
    return (
        assessment.submissions.select_related("documents", "score")
        .defer("payload")
        .order_by("-attempt_no")
        .first()
    )


def _rulings_by_run(assessment: Assessment, submission: Submission | None) -> list[Ruling]:
    """Every ruling on the case, across all its runs, oldest run first, in one query: with who
    ruled, and each run's attempt, version and whether it was force-scored. The latest run is given
    its own from these, so the page reads them once."""
    if submission is None:
        return []
    rulings = list(
        Ruling.objects.filter(submission__assessment=assessment)
        .select_related("reviewer")
        .annotate(
            run_attempt=F("submission__attempt_no"),
            run_version=KeyTextTransform("submission_version", "submission__payload"),
            run_forced=F("submission__score_forced_at"),
        )
        .order_by("submission__attempt_no", "created_at", "pk")
    )
    # The latest run's rulings, as a prefetch would give them (workflow reads them from the run).
    latest = submission.rulings.all()
    latest._result_cache = [r for r in rulings if r.submission_id == submission.pk]
    latest._prefetch_done = True
    submission._prefetched_objects_cache = {**getattr(submission, "_prefetched_objects_cache", {}), "rulings": latest}
    return rulings


def review_history(rulings: list[Ruling], submission: Submission | None, viewer: User) -> dict[str, list[dict]]:
    """Every ruling the reviewer made on each question, across all the case's runs, oldest first:
    the verdict and comment, the run's version (v1, v2 ...: as its request to the engine named it,
    so a retry keeps its run's; a run sent before versions were named goes by its attempt),
    whether it was on the latest run, and whether that run was scored at the reviewer's request.
    Who ruled is given to a reviewer only (null for an applicant)."""
    history: dict[str, list[dict]] = {}
    for r in rulings:
        history.setdefault(r.qid, []).append({
            "verdict": r.verdict,
            "comment": r.comment,
            "at": r.created_at,
            "by": r.reviewer.email if viewer.is_reviewer else None,
            "run": r.run_version or f"v{r.run_attempt}",
            "current": submission is not None and r.submission_id == submission.pk,
            "scoreForced": r.run_forced is not None,
        })
    return history


def case_payload(assessment: Assessment, viewer: User) -> dict:
    """Everything a case page shows: the stage, the latest run and its report, the reviewer's
    rulings, the score, the written assessment and the decision."""
    submission = _latest_run(assessment)
    rulings = _rulings_by_run(assessment, submission)
    decision = getattr(assessment, "decision", None)
    payload = {
        "stage": assessment.stage,
        "submittedAt": assessment.submitted_at,
        "decidedAt": assessment.decided_at,
        "run": None,
        "authentication": None,
        "flags": [],
        "rulings": {},
        "rejected": sorted(workflow.rejected_qids(assessment, submission)),
        # Answers sent back that still have no new document: resubmitting waits until this is empty.
        "unreplaced": [],
        # Under review: whether every flagged answer has a ruling, and where they send the case
        # ("accept": on to scoring; "return": back to the applicant). Null until then.
        "reviewOutcome": None,
        "score": None,
        "assessment": None,
        # Each question's rulings across every run, for the score breakdown's reviewer labels.
        "reviewHistory": review_history(rulings, submission, viewer),
        "decision": None if decision is None else {
            "verdict": decision.verdict, "remarks": decision.remarks, "at": decision.decided_at,
            # Who decided it, for a reviewer: the account's email, the only name an account has. An
            # applicant is not shown a reviewer's sign-in (null: "the reviewer").
            "by": decision.reviewer.email if viewer.is_reviewer else None,
        },
    }
    if viewer.is_reviewer:
        # Which of the department's admins has it: only they act on it, the others read it.
        payload["reviewer"] = holder_payload(assessment)
    if submission is None:
        return payload
    payload["run"] = {
        "attempt": submission.attempt_no,
        "status": submission.status,
        "outcome": submission.outcome,
        "submittedAt": submission.submitted_at,
        "authenticatedAt": submission.authenticated_at,
        "completedAt": submission.completed_at,
        # A failed run the engine may still be working on: sending it again starts a second run.
        "unconfirmed": submission.status == RunStatus.FAILED and submission.error == workflow.UNCONFIRMED_SEND,
        # Scored at the reviewer's request although it did not authenticate CLEAR (force-score).
        "scoreForced": submission.score_forced_at is not None,
        "scoreForcedAt": submission.score_forced_at,
        # Why the engine did not score it when asked, if it did not.
        "forceScoreError": submission.force_error or None,
        # Whether the reviewer may ask the engine to score it (again).
        "canForceScore": workflow.can_force_score(assessment, submission),
    }
    docs = getattr(submission, "documents", None)
    authenticated = bool(docs and docs.authentication)
    # Read once where needed and shared below: the run's flags, and the documents it was sent with.
    flags = workflow.flagged_qids(submission) if authenticated or assessment.stage == Stage.REVIEW_PENDING else []
    if authenticated or assessment.stage == Stage.AWAITING_APPLICANT:
        prefetch_related_objects([submission], "evidence_files")
    if assessment.stage == Stage.REVIEW_PENDING:
        payload["reviewOutcome"] = workflow.review_outcome(submission, flags)
    if assessment.stage == Stage.AWAITING_APPLICANT:
        current = list(assessment.evidence.filter(superseded_at__isnull=True))
        payload["unreplaced"] = workflow.unreplaced_rejections(assessment, current, submission)
    if authenticated:
        evidence = list(submission.evidence_files.all())
        payload["authentication"] = adapt.authentication(assessment, docs.authentication, evidence)
        payload["flags"] = flags
        payload["rulings"] = {
            r.qid: {"verdict": r.verdict, "comment": r.comment, "at": r.created_at}
            for r in submission.rulings.all()
        }
    score = getattr(submission, "score", None)
    # The AI engine scores every case now. A score this app once calculated itself (an older case
    # whose flags the reviewer accepted) is still shown, so the record is complete; its source says
    # which, the pages label it, and on an undecided case the reviewer can ask the engine for its
    # own score, which replaces it.
    if score is not None:
        payload["score"] = _score_payload(score)
    if docs and docs.assessment:
        payload["assessment"] = adapt.final_assessment(assessment, docs.assessment)
    return payload


def _assessment(request, public_id) -> Assessment:
    return assessment_for(
        request.user, public_id,
        queryset=Assessment.objects.select_related("applicant", "decision", "decision__reviewer", "reviewer"),
    )


def _reloaded(assessment: Assessment) -> Assessment:
    """The case as a step left it, read again with its decision (refresh_from_db would drop the
    decision loaded with it, and reading it then takes a query of its own)."""
    return Assessment.objects.select_related("applicant", "decision", "decision__reviewer", "reviewer").get(pk=assessment.pk)


def _transition(fn, *args):
    try:
        return fn(*args)
    except workflow.HeldByOther as exc:
        raise coded_conflict(HELD_BY_OTHER, str(exc)) from None
    except workflow.TransitionError as exc:
        raise Conflict(str(exc)) from None


class CaseView(APIView):
    """The case as it stands, brought up to date with the engine first if a run is in flight."""

    def get(self, request, public_id):
        assessment = _assessment(request, public_id)
        # Only a run in flight can have moved on (sync does nothing otherwise); the case just read
        # is current then, and is not read again.
        if settings.ENGINE_FOLLOW_IN_REQUESTS and assessment.stage in workflow.FOLLOWED_STAGES:
            workflow.sync(assessment)
            assessment = _reloaded(assessment)
        return Response(case_payload(assessment, request.user))


class SubmitView(APIView):
    action = staticmethod(workflow.submit)

    def post(self, request, public_id):
        assessment = _assessment(request, public_id)
        require_owner(request.user, assessment)
        _transition(self.action, assessment, request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class ResubmitView(SubmitView):
    action = staticmethod(workflow.resubmit)


class RetryView(APIView):
    """After an engine failure, the applicant or the reviewer can send the run again."""

    def post(self, request, public_id):
        assessment = _assessment(request, public_id)
        if not request.user.is_reviewer:
            require_owner(request.user, assessment)
        _transition(workflow.retry, assessment, request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class RulingSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=Verdict.values)
    comment = serializers.CharField(max_length=2000)


class RulingView(APIView):
    permission_classes = [IsReviewer]

    def put(self, request, public_id, qid):
        assessment = _assessment(request, public_id)
        require_not_own(request.user, assessment)
        data = RulingSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        _transition(workflow.rule, assessment, qid, data.validated_data["verdict"],
                    data.validated_data["comment"], request.user)
        return Response(case_payload(_reloaded(assessment), request.user))

    def delete(self, request, public_id, qid):
        assessment = _assessment(request, public_id)
        require_not_own(request.user, assessment)
        _transition(workflow.undo_ruling, assessment, qid, request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class CompleteReviewView(APIView):
    """Reviewer: once every flagged answer has a ruling, sends the case on: to scoring if all were
    accepted, back to the applicant if any was rejected."""

    permission_classes = [IsReviewer]

    def post(self, request, public_id):
        assessment = _assessment(request, public_id)
        require_not_own(request.user, assessment)
        _transition(workflow.complete_review, assessment, request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class ForceScoreView(APIView):
    """Reviewer: asks the AI engine to score a case whose flagged answers were all accepted, when
    it was not scored (the engine refused or could not be reached, or the flags were accepted before
    scoring could be forced)."""

    permission_classes = [IsReviewer]

    def post(self, request, public_id):
        assessment = _assessment(request, public_id)
        require_not_own(request.user, assessment)
        _transition(workflow.force_score, assessment, request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class DecisionSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=Verdict.values)
    remarks = serializers.CharField(max_length=4000)


class DecisionView(APIView):
    permission_classes = [IsReviewer]

    def post(self, request, public_id):
        assessment = _assessment(request, public_id)
        require_not_own(request.user, assessment)
        data = DecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        _transition(workflow.decide, assessment, data.validated_data["verdict"],
                    data.validated_data["remarks"], request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class ClaimView(APIView):
    """POST: an admin takes the case to review it (`takeOver`: the super user takes it from the
    admin who has it). DELETE: the admin reviewing it, or the super user, gives it back."""

    permission_classes = [IsReviewer]

    def post(self, request, public_id):
        assessment = _assessment(request, public_id)
        require_not_own(request.user, assessment)
        take_over = request.data.get("takeOver") is True if isinstance(request.data, dict) else False
        _transition(workflow.claim, assessment, request.user, take_over)
        return Response(case_payload(_reloaded(assessment), request.user))

    def delete(self, request, public_id):
        assessment = _assessment(request, public_id)
        _transition(workflow.release, assessment, request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class AssignSerializer(serializers.Serializer):
    userId = serializers.IntegerField()


class AssignView(APIView):
    """The super user: GET who the case can be given to (its department's admins, and the super
    users); POST gives it to one of them."""

    permission_classes = [IsSuperUser]

    def get(self, request, public_id):
        assessment = _assessment(request, public_id)
        people = (
            User.objects.filter(is_active=True)
            .filter(Q(role=Role.SUPERUSER) | Q(role=Role.REVIEWER, departments=assessment.department_id))
            .exclude(pk=assessment.applicant_id)
            .distinct()
            .order_by("role", "email")
        )
        return Response([{"id": u.pk, "email": u.email, "superUser": u.is_super_user} for u in people])

    def post(self, request, public_id):
        assessment = _assessment(request, public_id)
        data = AssignSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        to = User.objects.filter(pk=data.validated_data["userId"]).first()
        if to is None:
            raise serializers.ValidationError({"userId": "Choose someone from the list."})
        _transition(workflow.assign, assessment, to, request.user)
        return Response(case_payload(_reloaded(assessment), request.user))


class _UpstreamBody:
    """The engine's response body, passed on chunk by chunk. Django closes it when the response
    ends, including when the browser goes away before the first chunk (a generator's finally would
    never run then), so the engine connection always goes back to the pool."""

    def __init__(self, stream, upstream):
        self._stream, self._upstream, self._closed = stream, upstream, False

    def __iter__(self):
        try:
            yield from self._upstream.iter_bytes()
        finally:
            self.close()

    def close(self):
        if not self._closed:
            self._closed = True
            self._stream.__exit__(None, None, None)


class HighlightView(APIView):
    """One of the engine's highlighted evidence PDFs, passed through after the access check so the
    engine is never reached from the browser."""

    def get(self, request, public_id, name):
        assessment = _assessment(request, public_id)
        if not _HIGHLIGHT_NAME.fullmatch(name) or assessment.stage == Stage.NOT_SUBMITTED:
            raise Http404
        submission = workflow.latest_submission(assessment)
        if submission is None or not submission.engine_request_id:
            raise Http404
        stream = engine.highlight(submission.engine_request_id, name)
        try:
            upstream = stream.__enter__()
        except engine.EngineUnavailable:
            raise ServiceUnavailable() from None
        if upstream is None:
            stream.__exit__(None, None, None)
            raise Http404

        response = StreamingHttpResponse(_UpstreamBody(stream, upstream), content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="{name}"'
        response["Cache-Control"] = "private, no-store"
        return response

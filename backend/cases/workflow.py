"""The case workflow: the only code that changes an assessment's stage.

    NOT_SUBMITTED --submit--> AUTH_RUNNING --CLEAR--> SCORING (engine) --> DECISION_PENDING --> ACCEPTED / REJECTED
                                   |                                          ^
                                   +--RETURN_TO_FILER--> REVIEW_PENDING --every flag ruled, all accepted, reviewer sends it on--> SCORING (forced)
                                   |       (no answer flagged: straight to DECISION_PENDING, unscored)
                                   |                         +--every flag ruled, any rejected, reviewer returns it--> AWAITING_APPLICANT --resubmit--> AUTH_RUNNING
                                   +--engine failure--> AUTH_FAILED --retry--> AUTH_RUNNING

Every transition locks the assessment row, checks the stage it starts from, and writes its audit
event in the same transaction. Engine calls happen outside those transactions, except while
following a run, which holds that run's row lock and takes the assessment's only to move it on."""

import datetime
import logging
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import BooleanField, ExpressionWrapper, F, Q
from django.utils import timezone

from engine import client as engine

from . import adapt, audit, catalogue, validation
from .models import (
    AnswerType,
    AnswerValue,
    ApplicantProfile,
    Assessment,
    Decision,
    EvidenceFile,
    Outcome,
    QuestionResult,
    ResultStatus,
    Ruling,
    RunStatus,
    Score,
    ScoreSource,
    Stage,
    Submission,
    SubmissionDocument,
    User,
    Verdict,
)

logger = logging.getLogger(__name__)


class TransitionError(Exception):
    """The requested step is not possible from the assessment's current stage."""


def _locked(assessment: Assessment, *allowed: Stage) -> Assessment:
    row = Assessment.objects.select_for_update().get(pk=assessment.pk)
    if row.stage not in allowed:
        raise TransitionError(f"Not possible while the assessment is {row.stage}.")
    return row


# ---- Who reviews a case ------------------------------------------------------------------------
# A department can have several admins. A submitted case is reviewed by one of them: the first to
# take it (or the one the super user gives it to). Only they rule on it, send it on and decide it;
# the others read it. Every check below runs on the case's locked row, so two admins acting at
# the same moment are taken one after the other, and the second is told who has it.

# Submitted and not decided: a case that can be taken, released or given to someone.
REVIEWABLE = (
    Stage.AUTH_RUNNING, Stage.AUTH_FAILED, Stage.REVIEW_PENDING, Stage.AWAITING_APPLICANT, Stage.SCORING,
    Stage.DECISION_PENDING,
)


class HeldByOther(TransitionError):
    """Another admin is reviewing the case."""


def _held_message(row: Assessment) -> str:
    return (
        f"{row.reviewer.email} is reviewing this case. Ask them to release it, or the super user to "
        "give it to you."
    )


def _take(row: Assessment, reviewer: User, action: str, actor: User | None = None, **metadata) -> None:
    """Gives the locked case to `reviewer`, recorded as done by `actor` (the reviewer themselves,
    unless the super user gave it to them). Checked against the account as it is now (not as the
    request found it): one losing the department at this very moment waits for, or is refused by,
    that change, so a case is never left with someone who can no longer see it."""
    from .accounts import lock_account
    from .permissions import may_manage

    lock_account(reviewer.pk)
    fresh = User.objects.get(pk=reviewer.pk)
    someone_else = actor is not None and actor.pk != reviewer.pk
    if row.applicant_id == fresh.pk:
        raise TransitionError(
            f"{fresh.email} cannot review their own application." if someone_else
            else "You cannot review your own application."
        )
    if not (fresh.is_active and may_manage(fresh, row.department)):
        raise TransitionError(
            f"{fresh.email} does not work on {row.department.name}." if someone_else
            else f"You no longer work on {row.department.name}."
        )
    previous = row.reviewer.email if row.reviewer_id else None
    row.reviewer, row.claimed_at = reviewer, timezone.now()
    row.save(update_fields=["reviewer", "claimed_at", "updated_at"])
    audit.record(actor or reviewer, action, assessment_ref=row.public_id,
                 metadata={"from": previous, "to": reviewer.email, **metadata})


def _hold(row: Assessment, reviewer: User) -> None:
    """On the locked row: the reviewer may act on the case if it is theirs. One nobody has taken
    becomes theirs with this first step (as if they had clicked Take this case)."""
    if row.reviewer_id == reviewer.pk:
        return
    if row.reviewer_id is not None:
        raise HeldByOther(_held_message(row))
    _take(row, reviewer, "case.claim", automatic=True)


def claim(assessment: Assessment, reviewer: User, take_over: bool = False) -> None:
    """An admin takes the case to review it. The super user may take over one another admin has."""
    with transaction.atomic():
        row = _locked(assessment, *REVIEWABLE)
        if row.reviewer_id == reviewer.pk:
            return
        if row.reviewer_id is not None and not (take_over and reviewer.is_super_user):
            raise HeldByOther(_held_message(row))
        _take(row, reviewer, "case.claim")


def release(assessment: Assessment, actor: User) -> None:
    """The admin reviewing the case (or the super user) gives it back: it waits in the queue,
    untaken, for any admin of its department. Its rulings stay."""
    with transaction.atomic():
        row = _locked(assessment, *REVIEWABLE)
        if row.reviewer_id is None:
            return
        if row.reviewer_id != actor.pk and not actor.is_super_user:
            raise HeldByOther(_held_message(row))
        previous = row.reviewer.email
        row.reviewer, row.claimed_at = None, None
        row.save(update_fields=["reviewer", "claimed_at", "updated_at"])
        audit.record(actor, "case.release", assessment_ref=row.public_id, metadata={"from": previous})


def assign(assessment: Assessment, to: User, by: User) -> None:
    """The super user gives the case to an admin of its department (or to a super user)."""
    with transaction.atomic():
        row = _locked(assessment, *REVIEWABLE)
        if row.reviewer_id == to.pk:
            return
        _take(row, to, "case.assign", actor=by)


def latest_submission(assessment: Assessment) -> Submission | None:
    return assessment.submissions.order_by("-attempt_no").first()


def flagged_qids(submission: Submission) -> list[str]:
    return list(submission.question_results.filter(status=ResultStatus.ISSUE).values_list("qid", flat=True))


def rejected_qids(assessment: Assessment, latest: Submission | None = None) -> set[str]:
    """Questions whose evidence the reviewer sent back on the latest run (pass it as `latest` if
    already loaded)."""
    if assessment.stage != Stage.AWAITING_APPLICANT:
        return set()
    sub = latest or latest_submission(assessment)
    if sub is None:
        return set()
    return {r.qid for r in sub.rulings.all() if r.verdict == Verdict.REJECTED}


# ---- Starting a run ---------------------------------------------------------------------------

# Recorded on a run whose send the engine never confirmed (it may still be working on it). The case
# reports it as a flag, not this text: other failure reasons name engine endpoints, which stay on
# the server.
UNCONFIRMED_SEND = (
    "The engine did not confirm receiving the submission in time. It may still be processing it: "
    "check with the engine team before sending it again, or a second run will start."
)

def documents_needed(questions: dict, answers: dict[str, str]) -> list[str]:
    """The questions a form must have a document for before it can be submitted: every answer that
    needs evidence, and the CV. The one rule for submitting and for the progress a draft shows."""
    return [qid for qid, q in questions.items() if catalogue.evidence_required(q, answers[qid])] + [catalogue.CV_QID]


def incomplete_for_submission(questions: dict, answers: dict[str, str], evidence: list[EvidenceFile]) -> list[str]:
    """What a form still lacks before it can be submitted: the document for every answer that
    needs one, the CV included. (Personal details are not collected from the applicant.) The data
    collection and review pages apply the same rule, and keep Submit disabled until it is met."""
    missing: list[str] = []
    unanswered = [qid for qid, q in questions.items() if q.answer_type == AnswerType.TEXT and not answers[qid].strip()]
    if unanswered:
        missing.append(f"answers for {', '.join(unanswered)}")
    attached = {e.qid for e in evidence}
    documents = [qid for qid in documents_needed(questions, answers) if qid not in attached]
    if documents:
        missing.append(f"documents for {', '.join(documents)}")
    return missing


def evidence_rule_breaks(questions: dict, evidence: list[EvidenceFile]) -> list[str]:
    """Documents attached under rules since tightened: a question's settings can change after a
    document was uploaded (fewer files, or a format withdrawn). The upload was checked then; what is
    sent is checked against the rules in force now."""
    breaks = []
    by_qid: dict[str, list[EvidenceFile]] = {}
    for e in evidence:
        by_qid.setdefault(e.qid, []).append(e)
    for qid, files in by_qid.items():
        if qid == catalogue.CV_QID:
            allowed, max_files = catalogue.CV_FILE_TYPES, 1
        elif qid in questions:
            allowed, max_files = questions[qid].file_types, questions[qid].max_files
        else:
            continue
        if len(files) > max_files:
            breaks.append(f"{qid} (only {max_files} document{'s' if max_files > 1 else ''} allowed)")
        formats = sorted({validation.extension(e.original_name) for e in files if not validation.format_allowed(e.original_name, allowed)})
        if formats:
            breaks.append(f"{qid} ({', '.join('.' + f for f in formats)} no longer accepted)")
    return breaks


def set_stage(row: Assessment, stage: Stage) -> list[str]:
    """Moves a case to a stage, recording when it got there (stage_changed_at) if that is a change.
    Every stage change goes through here. Returns the fields to save."""
    if row.stage != stage:
        row.stage_changed_at = timezone.now()
    row.stage = stage
    return ["stage", "stage_changed_at", "updated_at"]


def unreplaced_rejections(row: Assessment, evidence: list[EvidenceFile], latest: Submission | None = None) -> list[str]:
    """Answers the reviewer sent back that have no new document since the run they were rejected
    in: resubmitting them unchanged would only send the engine the same documents again. A document
    is new unless the same file was sent as the same type (EvidenceFile.identity). (Pass the latest
    run as `latest` if already loaded.)"""
    last = latest or latest_submission(row)
    if last is None:
        return []
    sent = {(e.qid, e.identity) for e in last.evidence_files.all()}
    rejected = rejected_qids(row, last)
    return sorted(
        qid for qid in rejected
        if not any(e.qid == qid and (e.qid, e.identity) not in sent for e in evidence)
    )


def _start_run(assessment: Assessment, actor: User, action: str, *from_stages: Stage) -> Submission:
    """Records a new run and sends it to the engine. The submission row is committed first, so a
    failed send leaves a visible AUTH_FAILED case rather than nothing."""
    with transaction.atomic():
        row = _locked(assessment, *from_stages)
        if actor.is_reviewer and actor.pk != row.applicant_id:
            # Sending a failed run again is the reviewer's step on the case like any other (the
            # applicant sending their own again is not reviewing it).
            _hold(row, actor)
        version = catalogue.version_for(row)
        questions = catalogue.questions(version.pk)
        saved = dict(AnswerValue.objects.filter(assessment=row).values_list("qid", "value"))
        # Every question is sent: one never answered goes as No, exactly as the form shows it.
        answers = {qid: saved.get(qid, catalogue.default_answer(q)) for qid, q in questions.items()}
        # A draft can predate a settings change that withdrew an answer it holds, or the No it
        # defaults to. (A text question has no list of answers.)
        withdrawn = [
            qid for qid, value in answers.items()
            if questions[qid].answer_type == AnswerType.CHOICE and value not in questions[qid].allowed_answers
        ]
        if withdrawn:
            raise TransitionError(
                f"The answer to {', '.join(withdrawn)} is no longer offered. Choose another answer, then submit."
            )
        evidence = list(EvidenceFile.objects.filter(assessment=row, superseded_at__isnull=True).order_by("pk"))
        # Only what answers this version's questions (and the CV) is sent: a document left under a
        # question since deleted would reach the engine with nothing to answer.
        evidence = [e for e in evidence if e.qid in questions or e.qid == catalogue.CV_QID]
        # And only what an answer needs: a document left under a question that no longer asks for
        # one (its settings changed) is not sent as if it did.
        evidence = [
            e for e in evidence
            if e.qid == catalogue.CV_QID or catalogue.evidence_required(questions[e.qid], answers[e.qid])
        ]
        profile = ApplicantProfile.objects.filter(pk=row.pk).first()
        # A first submission and a resubmission send what the applicant has now, so both must be
        # complete and within the question settings in force. A retry resends the failed run as it was.
        if Stage.NOT_SUBMITTED in from_stages or Stage.AWAITING_APPLICANT in from_stages:
            missing = incomplete_for_submission(questions, answers, evidence)
            if missing:
                raise TransitionError(f"Complete the form before submitting. Still missing: {'; '.join(missing)}.")
            broken = evidence_rule_breaks(questions, evidence)
            if broken:
                raise TransitionError(
                    f"Some documents no longer meet the question settings. Replace them, then submit: {'; '.join(broken)}."
                )
        if Stage.AWAITING_APPLICANT in from_stages:
            unreplaced = unreplaced_rejections(row, evidence)
            if unreplaced:
                raise TransitionError(
                    f"Attach new evidence for {', '.join(unreplaced)}, which the reviewer sent back, then resubmit."
                )
        last = latest_submission(row)
        if Stage.AUTH_FAILED in from_stages and last is not None:
            # A retry resends the failed run as it was, word for word and document for document, so
            # the new attempt is exactly the one it repeats.
            payload = last.payload
            evidence = list(last.evidence_files.order_by("pk"))
        else:
            # What earlier runs say about this one: its version, and on a resubmission the
            # reviewer's rulings and the documents already sent.
            previous = list(row.submissions.order_by("attempt_no").prefetch_related("evidence_files", "rulings"))
            history = adapt.run_history(previous)
            payload = adapt.submission_payload(row, questions, answers, profile, evidence, history)
        submission = Submission.objects.create(
            assessment=row, attempt_no=(last.attempt_no + 1) if last else 1, version=version, payload=payload
        )
        submission.evidence_files.set(evidence)
        moved = set_stage(row, Stage.AUTH_RUNNING)
        row.version = version
        row.submitted_at = row.submitted_at or timezone.now()
        row.save(update_fields=[*moved, "version", "submitted_at"])
        audit.record(actor, action, assessment_ref=row.public_id, target_type="submission",
                     target_id=submission.attempt_no)

    # Whatever stops the send (the engine, or a document missing from storage), the run must end
    # as AUTH_FAILED, where it can be sent again, never as a run the engine never heard of.
    files = []
    try:
        files = adapt.submission_files(evidence)
        request_id = engine.submit(payload, files)
    except engine.EngineUnconfirmed:
        # The engine may have the run. It has no way to recognise a repeated submission, so a retry
        # starts a second run; the failure says so, for whoever sends it again.
        logger.warning("Sending %s attempt %s: not confirmed in time", row.public_id, submission.attempt_no)
        _fail(submission, UNCONFIRMED_SEND)
    except engine.EngineUnavailable as exc:
        _fail(submission, str(exc))
    except Exception:
        logger.exception("Sending %s attempt %s failed", row.public_id, submission.attempt_no)
        _fail(submission, "The submission could not be sent.")
    else:
        try:
            # Only if the run is still waiting: one that sync gave up on as interrupted stays failed.
            with transaction.atomic():
                Submission.objects.filter(pk=submission.pk, status=RunStatus.QUEUED).update(
                    engine_request_id=request_id, status=RunStatus.RUNNING
                )
        except IntegrityError:
            # The engine named another run's id: following it would mix the two cases up.
            logger.error("The engine returned request id %s, already used by another run", request_id)
            _fail(submission, "The engine returned a request id that belongs to another run.")
    finally:
        for _, fh, *_ in files:
            fh.close()
    submission.refresh_from_db()
    return submission


def submit(assessment: Assessment, applicant: User) -> Submission:
    return _start_run(assessment, applicant, "case.submit", Stage.NOT_SUBMITTED)


def resubmit(assessment: Assessment, applicant: User) -> Submission:
    return _start_run(assessment, applicant, "case.resubmit", Stage.AWAITING_APPLICANT)


def retry(assessment: Assessment, actor: User) -> Submission:
    return _start_run(assessment, actor, "case.retry", Stage.AUTH_FAILED)


def _fail(submission: Submission, error: str) -> None:
    """Ends a run as failed, and the case with it while that run is still the case's current one.
    A late or repeated call for a run that has already ended, or been replaced by a retry,
    changes nothing."""
    if Submission.objects.filter(pk=submission.pk, score_forced_at__isnull=False).exists():
        # A forced run was authenticated already: only the scoring the reviewer asked for failed.
        _force_failed(submission, error, None)
        return
    with transaction.atomic():
        # The run's row first, then the assessment's: the order sync takes them in.
        ended = Submission.objects.filter(pk=submission.pk, status__in=[RunStatus.QUEUED, RunStatus.RUNNING]).update(
            status=RunStatus.FAILED, error=error[:500], completed_at=timezone.now()
        )
        if not ended:
            return
        row = Assessment.objects.select_for_update().get(pk=submission.assessment_id)
        if row.stage not in (Stage.AUTH_RUNNING, Stage.SCORING):
            return
        if latest_submission(row).pk != submission.pk:
            return
        row.save(update_fields=set_stage(row, Stage.AUTH_FAILED))
        audit.record(None, "case.auth_failed", assessment_ref=row.public_id, target_type="submission",
                     target_id=submission.attempt_no)


# ---- Following a run --------------------------------------------------------------------------

def follow_due_runs(limit: int, assessments=None) -> int:
    """Brings up to `limit` runs that are due a check up to date, longest-unchecked first, and
    returns how many it followed. The background worker calls it for every run; the assessment
    list calls it for the runs it is about to show, as a fallback while no worker is running (with
    a worker, nothing is ever due by then, so the list does no engine calls). Stops at the first
    sign the engine is unreachable; one run failing does not stop the others."""
    now = timezone.now()
    cutoff = now - datetime.timedelta(seconds=settings.ENGINE_POLL_INTERVAL_SECONDS)
    # A run still being sent has no engine id: nothing to ask the engine yet. It is only due once its
    # sending window has passed (to be failed); before that it would take a place in the limit, and
    # never stop being due, while runs the engine is working on waited behind it.
    sending_window = datetime.timedelta(seconds=engine.submit_max_seconds() + 30)
    due = (
        Submission.objects.filter(status__in=[RunStatus.QUEUED, RunStatus.RUNNING])
        .filter(Q(last_polled_at__isnull=True) | Q(last_polled_at__lt=cutoff))
        .filter(Q(engine_request_id__isnull=False) | Q(submitted_at__lt=now - sending_window))
    )
    if assessments is not None:
        due = due.filter(assessment__in=assessments)
    followed = 0
    # Never the payload sent to the engine: following a run does not read it.
    due = due.select_related("assessment").defer("payload")
    for submission in due.order_by(F("last_polled_at").asc(nulls_first=True))[:limit]:
        try:
            if not sync(submission.assessment):
                break
        except Exception:
            logger.exception("Following %s attempt %s failed", submission.assessment.public_id, submission.attempt_no)
        followed += 1
    return followed


# The stages in which a run is with the engine, and sync follows it.
FOLLOWED_STAGES = (Stage.AUTH_RUNNING, Stage.SCORING)


def sync(assessment: Assessment) -> bool:
    """Brings an in-flight case up to date with the engine. Cheap to call on every page view: it
    asks the engine at most once per poll interval per run, and only one request follows a run at
    a time (others skip rather than wait). Returns False when the engine could not be reached.

    Three steps, so no transaction or row lock is held while the engine answers (a slow engine
    holds up nothing else): claim the run, fetch what the engine has ready, then save it."""
    if assessment.stage not in FOLLOWED_STAGES:
        return True
    claimed = _claim(assessment)
    if claimed is None:
        return True
    submission, have = claimed
    try:
        fetched = _fetch(submission, have)
    except engine.EngineUnavailable:
        # A hiccup reaching the engine is not a failed run: try again next poll.
        return False
    except engine.RunNotFound:
        transaction.on_commit(lambda: _fail(submission, "The engine no longer has this run."))
        return True
    except Exception:
        logger.exception("Following %s attempt %s failed", assessment.public_id, submission.attempt_no)
        transaction.on_commit(lambda: _fail(submission, "The engine's response could not be read."))
        return True
    try:
        with transaction.atomic():
            # Still the run that was claimed, and still in progress (not failed or retried meanwhile).
            current = (
                Submission.objects.select_for_update()
                .defer("payload")
                .filter(pk=submission.pk, status__in=[RunStatus.QUEUED, RunStatus.RUNNING],
                        engine_request_id=submission.engine_request_id)
                .first()
            )
            if current is not None:
                _advance(current, fetched)
    except Exception:
        # An engine answer this code cannot read would fail the same way on every poll.
        logger.exception("Following %s attempt %s failed", assessment.public_id, submission.attempt_no)
        transaction.on_commit(lambda: _fail(submission, "The engine's response could not be read."))
    return True


def _claim(assessment: Assessment) -> tuple[Submission, dict] | None:
    """Takes the case's run for this poll, in a short transaction: marks it polled now, so another
    request within the poll interval leaves it alone. Returns the run and what is already saved for
    it, or None when there is nothing to ask the engine (and fails a run that can no longer finish)."""
    cutoff = timezone.now() - datetime.timedelta(seconds=settings.ENGINE_POLL_INTERVAL_SECONDS)
    with transaction.atomic():
        submission = (
            Submission.objects.select_for_update(skip_locked=True)
            .defer("payload")
            .filter(assessment=assessment, status__in=[RunStatus.QUEUED, RunStatus.RUNNING])
            .order_by("-attempt_no")
            .first()
        )
        if submission is None:
            return None
        if not submission.engine_request_id:
            # Never acknowledged by the engine. A send has a hard time limit, so once it has passed
            # (with a margin), the process that was sending is gone (a restart, say): the run is
            # failed and can be sent again.
            sending_window = datetime.timedelta(seconds=engine.submit_max_seconds() + 30)
            if submission.submitted_at < timezone.now() - sending_window:
                transaction.on_commit(
                    lambda: _fail(submission, "The submission was interrupted before the engine received it.")
                )
            return None
        started = submission.score_forced_at or submission.submitted_at
        if started < timezone.now() - datetime.timedelta(seconds=settings.ENGINE_MAX_RUN_SECONDS):
            transaction.on_commit(lambda: _fail(submission, "The engine did not finish the run in time."))
            return None
        if submission.last_polled_at and submission.last_polled_at > cutoff:
            return None
        submission.last_polled_at = timezone.now()
        submission.save(update_fields=["last_polled_at"])
        docs = _saved_documents().filter(submission=submission).first()
        have = {
            "authentication": bool(docs and docs.has_authentication),
            "assessment": bool(docs and docs.has_assessment),
            "score": Score.objects.filter(submission=submission, source=ScoreSource.ENGINE).exists(),
            "outcome": submission.outcome,
        }
    return submission, have


def _saved_documents():
    """The run's engine documents row, telling which documents are saved without reading them
    (they are large): has_authentication and has_assessment. The documents themselves are read
    only if used, and written with update_fields."""
    saved = lambda field: ExpressionWrapper(Q(**{f"{field}__isnull": False}), output_field=BooleanField())
    return SubmissionDocument.objects.defer("authentication", "score", "assessment").annotate(
        has_authentication=saved("authentication"), has_assessment=saved("assessment")
    )


def _fetch(submission: Submission, have: dict) -> dict:
    """Asks the engine for the run's status and every document it has ready that is not saved
    yet, in the order _advance saves them. No transaction is open here."""
    request_id = submission.engine_request_id
    status = engine.status(request_id)
    fetched: dict = {"status": status}
    stages = status.get("stages", {})
    if status.get("status") == "FAILED" or stages.get("authentication") == "FAILED":
        return fetched
    outcome = have["outcome"]
    if not have["authentication"] and stages.get("authentication") == "READY":
        fetched["result"] = engine.result(request_id)
        if fetched["result"] is None:
            return fetched
        outcome = fetched["result"].get("data_authentication_summary", {}).get("outcome")
    if outcome != Outcome.CLEAR and not _scoring_resumed(submission, status):
        return fetched
    score_stage = stages.get("score")
    if not have["score"]:
        if score_stage == "READY":
            fetched["score"] = engine.score(request_id)
            if fetched["score"] is None:
                return fetched
        elif score_stage not in ("NOT_PRODUCED", "FAILED") or not _forced_settled(submission, status):
            return fetched
    if stages.get("assessment") == "READY" and not have["assessment"]:
        fetched["assessment"] = engine.assessment(request_id)
    return fetched


def _advance(submission: Submission, fetched: dict) -> None:
    """Saves what _fetch brought back and moves the case on. Inside sync's short transaction."""
    status = fetched["status"]
    stages = status.get("stages", {})
    if status.get("status") == "FAILED" or stages.get("authentication") == "FAILED":
        transaction.on_commit(lambda: _fail(submission, status.get("error") or "The engine reported a failure."))
        return

    docs, created = _saved_documents().get_or_create(submission=submission)
    has_authentication = not created and docs.has_authentication
    has_assessment = not created and docs.has_assessment

    if not has_authentication and stages.get("authentication") == "READY":
        result = fetched.get("result")
        if result is None:
            return
        outcome = result.get("data_authentication_summary", {}).get("outcome")
        if outcome not in Outcome.values:
            # Missing or unknown: authentication did not finish in a way this app understands, so
            # nothing is scored or sent to the reviewer; the run fails and can be sent again.
            transaction.on_commit(
                lambda: _fail(submission, f"The engine returned an authentication outcome this app does not know: {outcome!r}.")
            )
            return
        docs.authentication = result
        docs.save(update_fields=["authentication"])
        QuestionResult.objects.bulk_create([
            QuestionResult(
                submission=submission, qid=r["qid"], status=r["status"], verdict=r["verdict"],
                confidence=None if r["confidence"] is None else Decimal(str(r["confidence"])),
            )
            for r in adapt.question_results(result)
        ])
        submission.outcome = outcome
        submission.engine_version = (result.get("engine") or {}).get("version", "")
        submission.authenticated_at = timezone.now()
        submission.save(update_fields=["outcome", "engine_version", "authenticated_at"])
        if submission.outcome != Outcome.CLEAR:
            _finish_run(submission)
            if flagged_qids(submission):
                _move_run(submission, Stage.REVIEW_PENDING, "case.review_pending")
            else:
                # Returned with no answer at fault (only the CV, say): there is nothing to rule on,
                # so it goes to the reviewer's decision, report in view. The engine does not score a
                # submission that did not authenticate CLEAR, so it is decided without a score.
                _move_run(submission, Stage.DECISION_PENDING, "case.ready_for_decision")
            return
        _move_run(submission, Stage.SCORING, "case.scoring")

    if submission.outcome != Outcome.CLEAR and not _scoring_resumed(submission, status):
        # Forced, but the engine has not started scoring it: given up on after a while, so the
        # case goes back to the decision (where the reviewer can ask again) rather than waiting on.
        started = submission.score_forced_at
        if started and started < timezone.now() - datetime.timedelta(seconds=settings.ENGINE_FORCE_START_SECONDS):
            transaction.on_commit(lambda: _fail(submission, "The AI engine did not start scoring it. Try again."))
        return
    settled = _forced_settled(submission, status)
    score_stage, assessment_stage = stages.get("score"), stages.get("assessment")
    scored = Score.objects.filter(submission=submission, source=ScoreSource.ENGINE).exists()
    if not scored:
        if score_stage == "READY":
            document = fetched.get("score")
            if document is None:
                return
            docs.score = document
            docs.save(update_fields=["score"])
            # A score this app once calculated itself gives way to the engine's.
            Score.objects.filter(submission=submission).exclude(source=ScoreSource.ENGINE).delete()
            Score.objects.create(submission=submission, source=ScoreSource.ENGINE, **_rounded(adapt.score_from_engine(document)))
            scored = True
        elif score_stage not in ("NOT_PRODUCED", "FAILED") or not settled:
            return
        # NOT_PRODUCED or FAILED: CLEAR but unscored by the engine. Only the engine scores, so the
        # case goes on to the decision without one.
    if assessment_stage == "READY" and not has_assessment:
        document = fetched.get("assessment")
        if document is None:
            return  # reported ready but not served yet: the next poll fetches it
        docs.assessment = document
        docs.save(update_fields=["assessment"])
    elif assessment_stage not in ("READY", "NOT_PRODUCED", "FAILED") or (assessment_stage != "READY" and not settled):
        return
    _finish_run(submission)
    if submission.score_forced_at and not scored:
        Submission.objects.filter(pk=submission.pk).update(force_error="The AI engine did not produce a score.")
    _move_run(submission, Stage.DECISION_PENDING, "case.scored" if scored else "case.ready_for_decision")


def _move_run(submission: Submission, stage: Stage, action: str) -> None:
    """Moves the run's assessment on. Its row is locked only here, after the engine calls, so a
    slow engine never holds up anything else that touches the assessment."""
    _move(Assessment.objects.select_for_update().get(pk=submission.assessment_id), stage, action)


def _finish_run(submission: Submission) -> None:
    submission.status = RunStatus.COMPLETED
    submission.completed_at = timezone.now()
    submission.save(update_fields=["status", "completed_at"])


def _move(assessment: Assessment, stage: Stage, action: str, actor: User | None = None) -> None:
    assessment.save(update_fields=set_stage(assessment, stage))
    audit.record(actor, action, assessment_ref=assessment.public_id)


def _rounded(score: dict) -> dict:
    return {
        **score,
        "risk_score": Decimal(str(score["risk_score"])).quantize(Decimal("0.001")),
        "normalised": Decimal(str(score["normalised"])).quantize(Decimal("0.000001")),
    }


# ---- The reviewer's work ----------------------------------------------------------------------

def rule(assessment: Assessment, qid: str, verdict: str, comment: str, reviewer: User) -> None:
    """Records the reviewer's ruling on one flagged answer. The case stays under review, and any
    ruling can be undone, until the reviewer sends it on with complete_review."""
    with transaction.atomic():
        row = _locked(assessment, Stage.REVIEW_PENDING)
        _hold(row, reviewer)
        submission = latest_submission(row)
        flags = flagged_qids(submission)
        if qid not in flags:
            raise TransitionError("Only a flagged answer can be ruled on.")
        Ruling.objects.update_or_create(
            submission=submission, qid=qid, defaults={"verdict": verdict, "comment": comment, "reviewer": reviewer}
        )
        # An action on the case: it comes to the top of the reviewer's queue.
        row.save(update_fields=["updated_at"])
        audit.record(reviewer, "case.rule", assessment_ref=row.public_id, target_type="question", target_id=qid,
                     metadata={"verdict": verdict})


def review_outcome(submission: Submission | None, flags: list[str] | None = None) -> str | None:
    """Where the reviewer's rulings send the case once every flagged answer has one: "accept" (all
    accepted: on to scoring) or "return" (any rejected: back to the applicant). None while a flag
    still waits for a ruling. (Pass the run's flags as `flags` if already known.)"""
    if submission is None:
        return None
    if flags is None:
        flags = flagged_qids(submission)
    verdicts = {r.qid: r.verdict for r in submission.rulings.all()}
    if not flags or not set(flags) <= set(verdicts):
        return None
    return "return" if Verdict.REJECTED in verdicts.values() else "accept"


def complete_review(assessment: Assessment, reviewer: User) -> None:
    """The reviewer sends the case on once every flagged answer has a ruling: back to the applicant,
    with the comments, if any was rejected (the engine is not involved); otherwise to the engine to
    be scored after all (force-score), then on to the decision with its score and assessment."""
    forced = False
    with transaction.atomic():
        row = _locked(assessment, Stage.REVIEW_PENDING)
        _hold(row, reviewer)
        submission = latest_submission(row)
        outcome = review_outcome(submission)
        if outcome is None:
            raise TransitionError("Rule on every flagged answer first.")
        if outcome == "return":
            _move(row, Stage.AWAITING_APPLICANT, "case.returned_to_applicant", reviewer)
        elif settings.ENGINE_FORCE_SCORE and submission.engine_request_id:
            _move(row, Stage.SCORING, "case.force_score", reviewer)
            _start_forcing(submission)
            forced = True
        else:
            _move(row, Stage.DECISION_PENDING, "case.ready_for_decision", reviewer)
    if forced:
        # After the move is saved: the engine call holds no lock.
        _request_forced_score(assessment, reviewer)


# ---- Scoring a run the reviewer accepted ------------------------------------------------------

def can_force_score(assessment: Assessment, submission: Submission | None) -> bool:
    """Whether the reviewer may ask the engine to score this case's run after all: a run that was
    authenticated but not CLEAR, with no score, that is not being followed, while the case waits
    on the decision (or is left in SCORING by a request that never reached the engine)."""
    if not settings.ENGINE_FORCE_SCORE or submission is None or not submission.engine_request_id:
        return False
    if submission.outcome in (None, Outcome.CLEAR):
        return False
    if submission.status in (RunStatus.QUEUED, RunStatus.RUNNING):
        return False
    if assessment.stage not in (Stage.DECISION_PENDING, Stage.SCORING):
        return False
    # A score this app calculated itself (before only the engine scored) does not stop it: the
    # engine's score replaces it.
    return not Score.objects.filter(submission=submission, source=ScoreSource.ENGINE).exists()


def force_score(assessment: Assessment, reviewer: User) -> None:
    """The reviewer asks again for a case on the decision without a score (the engine refused or
    could not be reached the first time, or the flags were accepted before scoring was forced)."""
    with transaction.atomic():
        row = _locked(assessment, Stage.DECISION_PENDING, Stage.SCORING)
        _hold(row, reviewer)
        submission = latest_submission(row)
        if not can_force_score(row, submission):
            raise TransitionError("This assessment cannot be sent to the AI engine for scoring.")
        if row.stage != Stage.SCORING:
            _move(row, Stage.SCORING, "case.force_score", reviewer)
        _start_forcing(submission)
    _request_forced_score(assessment, reviewer)


def _start_forcing(submission: Submission) -> None:
    """Marks the run as being scored at the reviewer's request, in the transaction that moves the
    case to SCORING, so the run is followed from then on whatever happens to the engine call: a
    second request finds it running and is refused, and a request that never reaches the engine
    ends after ENGINE_FORCE_START_SECONDS instead of leaving the case in SCORING."""
    Submission.objects.filter(pk=submission.pk).update(
        status=RunStatus.RUNNING, score_forced_at=timezone.now(), force_error="", completed_at=None,
        last_polled_at=timezone.now(),
    )


def _request_forced_score(assessment: Assessment, actor: User | None) -> None:
    """Asks the engine to score the case's latest run although it did not authenticate CLEAR. On
    success the run is followed again, as one that is still running, until its score and
    assessment are saved. On a refusal the case goes back to the decision, unscored, with the reason."""
    submission = latest_submission(assessment)
    request_id = submission.engine_request_id
    try:
        engine.force_score(request_id, assessment.public_id)
    except engine.ForceRefused as exc:
        # Forced before (a repeated request, or a reviewer at the same moment): the engine then
        # reports the run CLEAR, and following it simply resumes.
        if not _engine_reports_clear(request_id):
            _force_failed(submission, str(exc), actor)
            return
    except engine.EngineUnavailable:
        _force_failed(submission, "The AI engine could not be reached. Try again shortly.", actor)
        return
    except Exception:
        logger.exception("Forcing the score of %s attempt %s failed", assessment.public_id, submission.attempt_no)
        _force_failed(submission, "The request to the AI engine failed. Try again shortly.", actor)
        return
    # Accepted: the run is already being followed (see _start_forcing); check on it at once.
    Submission.objects.filter(pk=submission.pk, status=RunStatus.RUNNING).update(last_polled_at=None)


def _engine_reports_clear(request_id: str) -> bool:
    try:
        return engine.status(request_id).get("outcome") == Outcome.CLEAR
    except (engine.EngineUnavailable, engine.RunNotFound):
        return False


def _force_failed(submission: Submission, reason: str, actor: User | None) -> None:
    """The engine did not score the run after all: the run ends (its authentication stands), the
    case goes to the decision without a score, and the reason is kept for the reviewer, who can ask
    again. A repeated call for a run already ended changes nothing."""
    with transaction.atomic():
        ended = Submission.objects.filter(pk=submission.pk, status__in=[RunStatus.QUEUED, RunStatus.RUNNING]).update(
            status=RunStatus.COMPLETED, completed_at=timezone.now(), score_forced_at=None, force_error=reason[:500]
        )
        if not ended:
            return
        row = Assessment.objects.select_for_update().get(pk=submission.assessment_id)
        if row.stage != Stage.SCORING or latest_submission(row).pk != submission.pk:
            return
        row.save(update_fields=set_stage(row, Stage.DECISION_PENDING))
        audit.record(actor, "case.force_score_failed", assessment_ref=row.public_id, metadata={"reason": reason[:200]})


def _scoring_resumed(submission: Submission, status: dict) -> bool:
    """A forced run once the engine has switched it to CLEAR (or already has its score ready): only
    then do its score and assessment stages describe the forced scoring rather than the original run."""
    if submission.score_forced_at is None:
        return False
    return status.get("outcome") == Outcome.CLEAR or status.get("stages", {}).get("score") == "READY"


def _forced_settled(submission: Submission, status: dict) -> bool:
    """Whether a stage the engine reports as not produced (or failed) can be believed. For a run
    that was not forced, always. For a forced run, only once the engine says it completed after it
    was forced: until then those stages may still be the original run's, before scoring resumed."""
    if submission.score_forced_at is None:
        return True

    def when(value):
        try:
            return datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
        except ValueError:
            return None

    forced_at, completed_at = when(status.get("score_forced_at")), when(status.get("completed_at"))
    if forced_at is None or completed_at is None:
        return False
    if forced_at.tzinfo is None or completed_at.tzinfo is None:
        forced_at, completed_at = forced_at.replace(tzinfo=None), completed_at.replace(tzinfo=None)
    return completed_at >= forced_at


def undo_ruling(assessment: Assessment, qid: str, reviewer: User) -> None:
    with transaction.atomic():
        row = _locked(assessment, Stage.REVIEW_PENDING)
        _hold(row, reviewer)
        deleted, _ = latest_submission(row).rulings.filter(qid=qid).delete()
        if not deleted:
            raise TransitionError("There is no ruling on this answer.")
        row.save(update_fields=["updated_at"])
        audit.record(reviewer, "case.undo_ruling", assessment_ref=row.public_id, target_type="question", target_id=qid)


def decide(assessment: Assessment, verdict: str, remarks: str, reviewer: User) -> None:
    with transaction.atomic():
        row = _locked(assessment, Stage.DECISION_PENDING)
        _hold(row, reviewer)
        Decision.objects.create(assessment=row, verdict=verdict, remarks=remarks, reviewer=reviewer)
        moved = set_stage(row, Stage.ACCEPTED if verdict == Verdict.ACCEPTED else Stage.REJECTED)
        row.decided_at = timezone.now()
        row.save(update_fields=[*moved, "decided_at"])
        audit.record(reviewer, "case.decide", assessment_ref=row.public_id, metadata={"verdict": verdict})

import datetime
import json
import re
from contextlib import contextmanager

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from cases import adapt, catalogue
from cases.models import AuditEvent, EvidenceFile, Score, Stage, Submission
from cases.tests import factories as make
from conftest import Api, engine_fixture
from engine import client
from engine.client import EngineUnavailable

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]

PDF = b"%PDF-1.7\n%test document\n"
PENDING = {"status": "RUNNING", "stages": {"authentication": "PENDING", "score": "PENDING", "assessment": "PENDING"}}


class FakeEngine:
    """Replays the real responses captured from the Data Authentication API (APP001 clear,
    APP004 returned to filer), and records what was sent to it."""

    def __init__(self, monkeypatch, run: str = "APP001-clear"):
        self.run = run
        self.status_doc = PENDING
        self.sent = []
        self.calls = 0
        self.fail_submit = False
        # (request id, application id) of every force-score request; a refusal to raise instead.
        self.forced = []
        self.force_refusal = None
        monkeypatch.setattr(client, "submit", self.submit)
        monkeypatch.setattr(client, "status", self.status)
        monkeypatch.setattr(client, "force_score", self.force_score)
        monkeypatch.setattr(client, "result", lambda rid: engine_fixture(f"result-{self.run}.json"))
        monkeypatch.setattr(client, "score", lambda rid: engine_fixture("score-APP001-clear.json") if self.scores else None)
        monkeypatch.setattr(client, "assessment", lambda rid: engine_fixture("assessment-APP001-clear.json") if self.scores else None)

    @property
    def scores(self):
        """A clear run is scored, and so is a forced one."""
        return self.run.endswith("clear") or bool(self.forced)

    def submit(self, payload, files):
        if self.fail_submit:
            raise EngineUnavailable("down")
        self.sent.append({"payload": payload, "files": [(name, ctype, doc) for name, _, ctype, doc in files]})
        return f"req{len(self.sent)}"

    def status(self, request_id):
        self.calls += 1
        if isinstance(self.status_doc, Exception):
            raise self.status_doc
        return self.status_doc

    def force_score(self, request_id, application_id):
        if self.force_refusal is not None:
            raise self.force_refusal
        self.forced.append((request_id, application_id))
        return {"request_id": request_id, "application_id": application_id}

    def finish(self):
        self.status_doc = engine_fixture(f"status-{self.run}.json")

    def finish_forced(self):
        """The engine, having set the forced run to CLEAR, has its score and assessment ready."""
        self.status_doc = engine_fixture("status-APP001-clear.json")


@pytest.fixture
def no_poll_delay(settings):
    settings.ENGINE_POLL_INTERVAL_SECONDS = 0


@pytest.fixture
def reviewer(as_user):
    return as_user(make.reviewer())


@pytest.fixture
def applicant(as_user):
    return as_user(make.user("m.vanwyk@example.na"))


# A document for every question that needs one with the form's answers (A1 Yes, the rest No),
# and the CV: what a first submission requires.
REQUIRED_DOCUMENTS = (
    ("A1", "NATIONAL_ID"), ("Q1", "DEGREE_CERT"), ("Q3", "EMPLOYMENT_LETTER"), ("PC1", "POLICE_CLEARANCE"),
    ("PC19", "TAX_COMPLIANCE_CERT"), ("CoI2", "COMPANY_REGISTRY_EXTRACT"), ("T1", "BOARD_APPOINTMENT_LETTER"),
    ("T2", "JOB_DESCRIPTION"), ("CS4", "SIGNED_DECLARATION"), ("CV", "CURRICULUM_VITAE"),
)


@pytest.fixture
def case(reviewer, applicant):
    """An assessment opened by the reviewer and completed by the applicant: A1 answered Yes and
    every required document attached, the CV included."""
    aid = reviewer.post("/api/assessments", {
        "applicantName": "Maria L. van Wyk", "email": "m.vanwyk@example.na", "entity": "Some Bank",
        "position": "Executive Director", "reference": "BL-2026-0398", "initiatedOn": "2026-08-25", "department": "banking",
    }).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"A1": "Yes"}})
    for qid, code in REQUIRED_DOCUMENTS:
        attach(applicant, aid, qid, code)
    return aid


_attached = iter(range(1, 10_000))


def attach(applicant, aid, qid, code):
    """Attaches a new document: each one different, as a real replacement would be (the same
    contents again is the same document)."""
    content = PDF + f"%copy {next(_attached)}\n".encode()
    response = applicant.post(f"/api/assessments/{aid}/evidence", {
        "file": SimpleUploadedFile("my scan (final).pdf", content), "qid": qid, "optionCode": code,
    }, multipart=True)
    assert response.status_code == 201, (qid, response.content)


def stage(aid):
    from cases.models import Assessment

    return Assessment.objects.get(public_id=aid).stage


# ---- Submitting -------------------------------------------------------------------------------

def test_a_first_submission_needs_every_required_document_but_no_personal_details(monkeypatch, applicant, case):
    fake = FakeEngine(monkeypatch)
    # Personal details are not collected, so none hold a submission back.
    cv = EvidenceFile.objects.get(assessment__public_id=case, qid="CV")
    assert applicant.delete(f"/api/assessments/{case}/evidence/{cv.public_id}").status_code == 204
    response = applicant.post(f"/api/assessments/{case}/submit")
    assert response.status_code == 409
    assert response.json()["detail"] == "Complete the form before submitting. Still missing: documents for CV."
    assert stage(case) == Stage.NOT_SUBMITTED and fake.sent == [] and not Submission.objects.exists()
    # Answering Yes where a document is needed only if Yes asks for that document too.
    applicant.patch(f"/api/assessments/{case}/form", {"answers": {"FC5": "Yes"}})
    attach(applicant, case, "CV", "CURRICULUM_VITAE")
    assert "documents for FC5." in applicant.post(f"/api/assessments/{case}/submit").json()["detail"]
    attach(applicant, case, "FC5", "BANK_REFERENCE_LETTER")
    assert applicant.post(f"/api/assessments/{case}/submit").json()["stage"] == "AUTH_RUNNING"


def test_submitting_sends_only_what_the_engine_needs(monkeypatch, applicant, case):
    fake = FakeEngine(monkeypatch)
    body = applicant.post(f"/api/assessments/{case}/submit").json()
    assert body["stage"] == "AUTH_RUNNING" and body["run"]["attempt"] == 1
    sent = fake.sent[0]
    payload = sent["payload"]
    assert payload["application_id"] == case
    assert set(payload["applicant"]) == {"full_name", "proposed_role", "date_of_birth", "town"}
    assert "72012700462" not in json.dumps(payload)  # the ID number never leaves
    assert payload["cv_verification"]["evidence"] == [{"doc_type": "curriculum_vitae", "role": "primary"}]
    a1 = next(q for s in payload["sections"] for q in s["questions"] if q["qid"] == "A1")
    assert a1["answer"] == "Yes" and a1["evidence"] == [{"doc_type": "national_id", "role": "primary"}]
    assert sorted(sent["files"]) == [
        (f"{doc_type}.pdf", "application/pdf", doc_type)
        for doc_type in sorted([
            "board_appointment_letter", "company_registry_extract", "curriculum_vitae", "degree_certificate",
            "employment_letter", "job_description", "national_id", "police_clearance", "suitability_declaration",
            "tax_compliance_certificate",
        ])
    ]
    # Submitted: the form is locked and a second submit is refused.
    assert applicant.post(f"/api/assessments/{case}/submit").status_code == 409
    assert applicant.patch(f"/api/assessments/{case}/form", {"answers": {"A4": "Yes"}}).status_code == 409


def test_only_the_applicant_submits(monkeypatch, reviewer, case):
    FakeEngine(monkeypatch)
    assert reviewer.post(f"/api/assessments/{case}/submit").status_code == 403


# ---- A clear run ------------------------------------------------------------------------------

def test_a_clear_run_is_scored_by_the_engine_and_waits_for_the_decision(monkeypatch, no_poll_delay, applicant, reviewer, case):
    fake = FakeEngine(monkeypatch, "APP001-clear")
    applicant.post(f"/api/assessments/{case}/submit")
    assert applicant.get(f"/api/assessments/{case}/case").json()["stage"] == "AUTH_RUNNING"

    fake.finish()
    body = applicant.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING"
    assert body["authentication"]["outcome"] == "CLEAR" and body["flags"] == []
    assert body["score"]["source"] == "engine" and body["score"]["band"] == "Moderate"
    assert body["assessment"]["determination"]["verdict"] == "CONDITIONAL"

    # Nothing in the response points at the engine.
    text = json.dumps(body)
    assert "40.81.225.53" not in text and "request_id" not in text and "33246a53a1" not in text
    concern = body["assessment"]["concerns"][0]
    assert concern["evidence_url"].startswith(f"/api/assessments/{case}/highlights/")

    response = reviewer.post(f"/api/assessments/{case}/decision", {"verdict": "accepted", "remarks": "Approved."})
    assert response.json()["stage"] == "ACCEPTED"
    assert response.json()["decision"]["remarks"] == "Approved."
    # Who decided it, for the summary's "Decided by": the reviewer sees the account, on every read;
    # the applicant is not shown a reviewer's sign-in.
    assert response.json()["decision"]["by"] == reviewer.user.email
    assert reviewer.get(f"/api/assessments/{case}/case").json()["decision"]["by"] == reviewer.user.email
    assert applicant.get(f"/api/assessments/{case}/case").json()["decision"]["by"] is None
    assert reviewer.post(f"/api/assessments/{case}/decision", {"verdict": "rejected", "remarks": "x"}).status_code == 409


def test_a_rejection_says_who_decided_it_to_the_reviewer_only(monkeypatch, no_poll_delay, applicant, reviewer, case):
    fake = FakeEngine(monkeypatch, "APP001-clear")
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    assert applicant.get(f"/api/assessments/{case}/case").json()["stage"] == "DECISION_PENDING"
    response = reviewer.post(f"/api/assessments/{case}/decision", {"verdict": "rejected", "remarks": "Not fit."})
    assert response.json()["stage"] == "REJECTED"
    assert response.json()["decision"] == {
        "verdict": "rejected", "remarks": "Not fit.", "at": response.json()["decision"]["at"], "by": reviewer.user.email,
    }
    assert reviewer.get(f"/api/assessments/{case}/case").json()["decision"]["by"] == reviewer.user.email
    assert applicant.get(f"/api/assessments/{case}/case").json()["decision"]["by"] is None


def test_the_engine_is_asked_at_most_once_per_poll_interval(monkeypatch, settings, applicant, case):
    settings.ENGINE_POLL_INTERVAL_SECONDS = 60
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    for _ in range(5):
        applicant.get(f"/api/assessments/{case}/case")
    assert fake.calls == 1


def test_polling_the_list_follows_running_cases(monkeypatch, no_poll_delay, applicant, reviewer, case):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    # Nobody opens the case: the list itself moves it on.
    listed = reviewer.get("/api/assessments").json()["results"]
    assert next(a for a in listed if a["id"] == case)["stage"] == "DECISION_PENDING"


def test_the_worker_follows_runs_without_any_page_open(monkeypatch, no_poll_delay, applicant, case):
    import io

    from django.core.management import call_command

    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    out = io.StringIO()
    call_command("follow_runs", "--once", stdout=out)
    assert stage(case) == Stage.DECISION_PENDING and "Followed 1 run" in out.getvalue()
    call_command("follow_runs", "--once", stdout=out)  # nothing left in progress
    assert "Followed 0 run" in out.getvalue()


def test_with_the_worker_running_the_list_makes_no_engine_calls(monkeypatch, settings, applicant, reviewer, case):
    import io

    from django.core.management import call_command

    settings.ENGINE_POLL_INTERVAL_SECONDS = 60
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    call_command("follow_runs", "--once", stdout=io.StringIO())
    assert fake.calls == 1  # the worker checked it
    for _ in range(3):
        reviewer.get("/api/assessments")
    assert fake.calls == 1  # just checked, so not due: the list only read the database


def test_the_list_stops_following_runs_once_the_engine_is_unreachable(monkeypatch, no_poll_delay, reviewer, applicant, case):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    second = reviewer.post("/api/assessments", {
        "applicantName": "Second Person", "email": "second@example.na", "entity": "Bank", "position": "Director",
        "reference": "BL-2026-0001", "initiatedOn": "2026-08-25", "department": "banking",
    }).json()["id"]
    second_applicant = Api(make.user("second@example.na"))
    second_applicant.post(f"/api/assessments/{second}/submit")
    fake.status_doc = EngineUnavailable("timeout")
    fake.calls = 0
    response = reviewer.get("/api/assessments")
    assert response.status_code == 200 and fake.calls == 1  # gave up after the first


def test_one_broken_case_does_not_break_the_list(monkeypatch, no_poll_delay, reviewer, applicant, case):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.status_doc = {"status": "RUNNING", "stages": None}  # a malformed answer: _advance raises
    response = reviewer.get("/api/assessments")
    assert response.status_code == 200 and response.json()["results"][0]["stage"] == "AUTH_RUNNING"


def test_a_send_that_was_never_acknowledged_fails_once_its_window_passes(
    monkeypatch, no_poll_delay, applicant, case, django_capture_on_commit_callbacks
):
    FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    # As if the process sending it died mid-upload: no engine id, still queued.
    Submission.objects.update(engine_request_id=None, status="queued")
    with django_capture_on_commit_callbacks(execute=True):
        applicant.get(f"/api/assessments/{case}/case")
    assert stage(case) == Stage.AUTH_RUNNING  # still within the sending window
    Submission.objects.update(submitted_at=timezone.now() - datetime.timedelta(hours=1))
    with django_capture_on_commit_callbacks(execute=True):
        applicant.get(f"/api/assessments/{case}/case")
    assert stage(case) == Stage.AUTH_FAILED
    assert applicant.post(f"/api/assessments/{case}/retry").json()["stage"] == "AUTH_RUNNING"


def test_an_assessment_reported_ready_but_not_served_is_fetched_later(monkeypatch, no_poll_delay, applicant, case):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    monkeypatch.setattr(client, "assessment", lambda rid: None)
    assert applicant.get(f"/api/assessments/{case}/case").json()["stage"] == "SCORING"
    monkeypatch.setattr(client, "assessment", lambda rid: engine_fixture("assessment-APP001-clear.json"))
    body = applicant.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING" and body["assessment"] is not None


def test_an_answer_withdrawn_after_it_was_saved_must_be_changed_before_submitting(monkeypatch, reviewer, applicant, case):
    fake = FakeEngine(monkeypatch)
    assert applicant.patch(f"/api/assessments/{case}/form", {"answers": {"T2": "N/A"}}).status_code == 200
    t2 = {"allowedAnswers": ["Yes", "No"], "fileTypes": ["pdf"], "maxFiles": 1}
    was = make.label()
    assert reviewer.put("/api/questionnaire", {"department": "banking", "version": was, "questions": {"T2": t2}}).json()["version"] == make.label() != was
    response = applicant.post(f"/api/assessments/{case}/submit")
    assert response.status_code == 409 and "T2" in response.json()["detail"]
    assert stage(case) == Stage.NOT_SUBMITTED and fake.sent == [] and not Submission.objects.exists()
    applicant.patch(f"/api/assessments/{case}/form", {"answers": {"T2": "No"}})
    # N/A dropped T2's document; answered No again, it needs one.
    attach(applicant, case, "T2", "JOB_DESCRIPTION")
    assert applicant.post(f"/api/assessments/{case}/submit").json()["stage"] == "AUTH_RUNNING"


def test_an_engine_answer_that_cannot_be_read_fails_the_run_so_it_can_be_retried(
    monkeypatch, no_poll_delay, applicant, case, django_capture_on_commit_callbacks
):
    fake = FakeEngine(monkeypatch, "APP004-return")
    original = adapt.question_results
    monkeypatch.setattr(adapt, "question_results", lambda result: [{**r, "status": "not_applicable"} for r in original(result)])
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    with django_capture_on_commit_callbacks(execute=True):
        response = applicant.get(f"/api/assessments/{case}/case")
    assert response.status_code == 200 and stage(case) == Stage.AUTH_FAILED
    assert not Submission.objects.get().question_results.exists()  # nothing half-saved
    assert applicant.post(f"/api/assessments/{case}/retry").json()["stage"] == "AUTH_RUNNING"


def test_a_run_the_engine_has_lost_fails(monkeypatch, no_poll_delay, applicant, case, django_capture_on_commit_callbacks):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.status_doc = client.RunNotFound("req1")
    with django_capture_on_commit_callbacks(execute=True):
        applicant.get(f"/api/assessments/{case}/case")
    assert stage(case) == Stage.AUTH_FAILED


def test_a_run_that_never_finishes_fails_after_the_limit(monkeypatch, no_poll_delay, applicant, case, django_capture_on_commit_callbacks):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    Submission.objects.update(submitted_at=timezone.now() - datetime.timedelta(hours=2))
    with django_capture_on_commit_callbacks(execute=True):
        applicant.get(f"/api/assessments/{case}/case")
    assert stage(case) == Stage.AUTH_FAILED and fake.calls == 0


def test_a_late_failure_of_an_old_run_leaves_the_newer_run_alone(monkeypatch, applicant, reviewer, case):
    from cases import workflow

    fake = FakeEngine(monkeypatch)
    fake.fail_submit = True
    applicant.post(f"/api/assessments/{case}/submit")
    fake.fail_submit = False
    reviewer.post(f"/api/assessments/{case}/retry")
    first = Submission.objects.get(attempt_no=1)
    Submission.objects.filter(pk=first.pk).update(status="running")  # as if its failure were still pending
    workflow._fail(first, "late")
    assert stage(case) == Stage.AUTH_RUNNING


def test_an_unreachable_engine_leaves_the_case_running(monkeypatch, no_poll_delay, applicant, case):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.status_doc = EngineUnavailable("timeout")
    response = applicant.get(f"/api/assessments/{case}/case")
    assert response.status_code == 200 and response.json()["stage"] == "AUTH_RUNNING"


# ---- A run returned to the filer ---------------------------------------------------------------

def send(reviewer, case, ruling):
    """Rules on PC1 (the only flag) and sends the case on with the button, as the reviewer does."""
    assert reviewer.put(f"/api/assessments/{case}/rulings/PC1", ruling).status_code == 200
    return reviewer.post(f"/api/assessments/{case}/complete-review").json()


@pytest.fixture
def flagged(monkeypatch, no_poll_delay, applicant, case):
    """APP004's real result: PC1 flagged (an undeclared conviction)."""
    fake = FakeEngine(monkeypatch, "APP004-return")
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    body = applicant.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "REVIEW_PENDING" and body["flags"] == ["PC1"] and body["score"] is None
    return fake


def test_a_return_with_no_answer_at_fault_goes_straight_to_the_decision(monkeypatch, no_poll_delay, applicant, case):
    # Returned to the filer, but no single answer has an issue (only the CV, say).
    original = adapt.question_results
    monkeypatch.setattr(adapt, "question_results", lambda result: [
        {**r, "status": "authenticated" if r["status"] == "issue" else r["status"]} for r in original(result)
    ])
    fake = FakeEngine(monkeypatch, "APP004-return")
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    body = applicant.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING" and body["flags"] == []
    assert body["score"] is None and not Score.objects.exists()  # only the engine scores


def test_a_rejected_document_follows_the_settings_the_case_was_submitted_under(reviewer, applicant, case, flagged):
    send(reviewer, case, {"verdict": "rejected", "comment": "Need the court order."})
    # Settings change after submission: PC1 would now take images only.
    pc1 = {"allowedAnswers": ["Yes", "No"], "fileTypes": ["png"], "maxFiles": 1}
    was = make.label()
    assert reviewer.put("/api/questionnaire", {"department": "banking", "version": was, "questions": {"PC1": pc1}}).json()["version"] == make.label() != was

    form = applicant.get(f"/api/assessments/{case}/form").json()
    assert next(a for a in form["answers"] if a["qid"] == "PC1")["fileTypes"] == ["pdf"]
    new = {"file": SimpleUploadedFile("court-order.pdf", PDF), "qid": "PC1", "optionCode": "POLICE_CLEARANCE"}
    assert applicant.post(f"/api/assessments/{case}/evidence", new, multipart=True).status_code == 201


def test_the_reviewer_rules_only_on_flagged_answers(reviewer, applicant, case, flagged):
    assert reviewer.put(f"/api/assessments/{case}/rulings/A1", {"verdict": "accepted", "comment": "ok"}).status_code == 409
    assert applicant.put(f"/api/assessments/{case}/rulings/PC1", {"verdict": "accepted", "comment": "ok"}).status_code == 403
    assert reviewer.put(f"/api/assessments/{case}/rulings/PC1", {"verdict": "accepted"}).status_code == 400


ACCEPT = {"verdict": "accepted", "comment": "Expunged."}


def test_accepting_every_flag_has_the_engine_score_the_same_run(reviewer, case, flagged):
    body = send(reviewer, case, ACCEPT)
    assert flagged.forced == [("req1", case)]  # the run reviewed, under the case's own id
    assert body["stage"] == "SCORING" and body["rulings"]["PC1"]["verdict"] == "accepted"
    assert body["run"]["scoreForced"] is True and body["run"]["status"] == "running"
    assert body["run"]["canForceScore"] is False
    # Until the engine reports the run CLEAR, its score stage still describes the original run.
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "SCORING" and body["score"] is None

    flagged.finish_forced()
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING"
    assert body["score"]["source"] == "engine" and body["score"]["band"] == "Moderate"
    assert body["assessment"] is not None  # the engine wrote its assessment too
    assert body["run"]["outcome"] == "RETURN_TO_FILER"  # what authentication found is kept
    assert body["run"]["forceScoreError"] is None and Submission.objects.get().status == "completed"
    actions = list(AuditEvent.objects.filter(assessment_ref=case).order_by("id").values_list("action", flat=True))
    assert actions[-2:] == ["case.force_score", "case.scored"]
    decided = reviewer.post(f"/api/assessments/{case}/decision", {"verdict": "accepted", "remarks": "Fine."})
    assert decided.json()["stage"] == "ACCEPTED"
    # The breakdown's reviewer label: accepted on the scored run, which the reviewer had scored.
    history = reviewer.get(f"/api/assessments/{case}/case").json()["reviewHistory"]
    assert set(history) == {"PC1"} and len(history["PC1"]) == 1
    entry = history["PC1"][0]
    assert (entry["verdict"], entry["comment"], entry["run"], entry["current"], entry["scoreForced"]) == (
        "accepted", "Expunged.", "v1", True, True,
    )
    assert entry["by"] == reviewer.user.email


def test_a_refused_force_score_leaves_the_case_on_the_decision_and_can_be_asked_again(applicant, reviewer, case, flagged):
    flagged.force_refusal = client.ForceRefused("The submission is still running.")
    body = send(reviewer, case, ACCEPT)
    assert body["stage"] == "DECISION_PENDING" and body["score"] is None
    assert body["run"]["forceScoreError"] == "The submission is still running."
    assert body["run"]["canForceScore"] is True
    assert AuditEvent.objects.filter(action="case.force_score_failed").exists()

    assert applicant.post(f"/api/assessments/{case}/force-score").status_code == 403
    flagged.force_refusal = None
    body = reviewer.post(f"/api/assessments/{case}/force-score").json()
    assert body["stage"] == "SCORING" and body["run"]["forceScoreError"] is None
    flagged.finish_forced()
    assert reviewer.get(f"/api/assessments/{case}/case").json()["score"]["source"] == "engine"
    # Scored: nothing more to ask for.
    assert reviewer.post(f"/api/assessments/{case}/force-score").status_code == 409


def test_an_unreachable_engine_leaves_the_case_on_the_decision(reviewer, case, flagged):
    flagged.force_refusal = EngineUnavailable("down")
    body = send(reviewer, case, ACCEPT)
    assert body["stage"] == "DECISION_PENDING"
    assert "could not be reached" in body["run"]["forceScoreError"] and body["run"]["canForceScore"] is True


def test_a_run_forced_before_is_simply_followed_again(reviewer, case, flagged):
    # The engine refuses a second force, but already reports the run CLEAR: it was forced.
    flagged.force_refusal = client.ForceRefused("Already forced.")
    flagged.finish_forced()
    flagged.forced.append(("req1", case))  # forced earlier, so the engine serves its score
    send(reviewer, case, ACCEPT)
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING" and body["score"]["source"] == "engine"


def test_a_forced_run_that_fails_goes_back_to_the_decision_not_to_auth_failed(
    reviewer, case, flagged, django_capture_on_commit_callbacks
):
    send(reviewer, case, ACCEPT)
    flagged.status_doc = {**engine_fixture("status-APP001-clear.json"), "status": "FAILED", "error": "Scoring crashed."}
    with django_capture_on_commit_callbacks(execute=True):
        reviewer.get(f"/api/assessments/{case}/case")
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING" and body["score"] is None
    assert body["run"]["forceScoreError"] == "Scoring crashed." and body["run"]["status"] == "completed"
    assert body["run"]["canForceScore"] is True


def test_a_forced_runs_time_limit_counts_from_when_it_was_forced(reviewer, case, flagged):
    # Sent long ago, but forced just now: still followed, not failed as overdue.
    Submission.objects.update(submitted_at=timezone.now() - datetime.timedelta(days=1))
    send(reviewer, case, ACCEPT)
    flagged.finish_forced()
    assert reviewer.get(f"/api/assessments/{case}/case").json()["score"]["source"] == "engine"


def test_with_force_score_off_accepting_every_flag_goes_to_the_decision_unscored(reviewer, case, flagged, settings):
    settings.ENGINE_FORCE_SCORE = False
    body = send(reviewer, case, ACCEPT)
    assert body["stage"] == "DECISION_PENDING" and body["score"] is None and flagged.forced == []
    assert body["run"]["canForceScore"] is False


def test_force_score_is_only_possible_on_an_unscored_case_waiting_for_the_decision(reviewer, case, flagged):
    # Still under review: the reviewer rules first.
    assert reviewer.post(f"/api/assessments/{case}/force-score").status_code == 409
    assert flagged.forced == []


def test_the_engine_is_sent_exactly_the_three_keys(monkeypatch):
    import httpx

    seen = {}

    def handler(request):
        seen["path"], seen["body"] = request.url.path, json.loads(request.content)
        return httpx.Response(200, json={"request_id": "839f34ccb9"})

    monkeypatch.setattr(client, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler), base_url="http://engine"))
    client.force_score("839f34ccb9", "FNP-2026-0001")
    assert seen == {
        "path": "/authentication/force-score",
        "body": {"request_id": "839f34ccb9", "application_id": "FNP-2026-0001", "is_score_forced": True},
    }

    def refuse(request):
        return httpx.Response(409, json={"detail": "Already forced."})

    monkeypatch.setattr(client, "_client", lambda: httpx.Client(transport=httpx.MockTransport(refuse), base_url="http://engine"))
    with pytest.raises(client.ForceRefused, match="Already forced."):
        client.force_score("839f34ccb9", "FNP-2026-0001")


def test_a_rejection_returns_the_case_and_only_that_document_can_change(reviewer, applicant, case, flagged):
    body = send(reviewer, case, {"verdict": "rejected", "comment": "Need the court order."})
    assert body["stage"] == "AWAITING_APPLICANT" and body["rejected"] == ["PC1"]

    new = {"file": SimpleUploadedFile("court-order.pdf", PDF), "qid": "PC1", "optionCode": "POLICE_CLEARANCE"}
    assert applicant.post(f"/api/assessments/{case}/evidence", new, multipart=True).status_code == 201
    other = {"file": SimpleUploadedFile("id.pdf", PDF), "qid": "A1", "optionCode": "NATIONAL_ID"}
    assert applicant.post(f"/api/assessments/{case}/evidence", other, multipart=True).status_code == 409
    # The document the first run read is kept, marked superseded.
    assert EvidenceFile.objects.filter(qid="PC1").count() == 2
    assert EvidenceFile.objects.filter(qid="PC1", superseded_at__isnull=False).count() == 1

    flagged.status_doc = PENDING
    body = applicant.post(f"/api/assessments/{case}/resubmit").json()
    assert body["stage"] == "AUTH_RUNNING" and body["run"]["attempt"] == 2
    first, second = Submission.objects.order_by("attempt_no")
    assert first.rulings.count() == 1 and second.rulings.count() == 0


def test_a_ruling_can_be_undone_while_others_are_pending(reviewer, case, flagged, monkeypatch):
    # Make two flags so the first ruling leaves the case in review.
    from cases.models import QuestionResult

    QuestionResult.objects.filter(qid="A1").update(status="issue")
    reviewer.put(f"/api/assessments/{case}/rulings/PC1", {"verdict": "accepted", "comment": "ok"})
    assert stage(case) == Stage.REVIEW_PENDING
    body = reviewer.delete(f"/api/assessments/{case}/rulings/PC1").json()
    assert body["rulings"] == {}
    assert reviewer.delete(f"/api/assessments/{case}/rulings/PC1").status_code == 409


def test_a_rejection_waits_until_every_flag_is_ruled_on(reviewer, case, flagged):
    from cases.models import QuestionResult

    QuestionResult.objects.filter(qid="A1").update(status="issue")
    body = reviewer.put(f"/api/assessments/{case}/rulings/PC1", {"verdict": "rejected", "comment": "Court order."}).json()
    # The reviewer can still rule on A1, and change their mind on PC1.
    assert body["stage"] == "REVIEW_PENDING"
    body = reviewer.put(f"/api/assessments/{case}/rulings/A1", {"verdict": "accepted", "comment": "Fine."}).json()
    assert body["stage"] == "REVIEW_PENDING" and body["reviewOutcome"] == "return"
    body = reviewer.post(f"/api/assessments/{case}/complete-review").json()
    assert body["stage"] == "AWAITING_APPLICANT" and body["rejected"] == ["PC1"]


# ---- Engine failures --------------------------------------------------------------------------

def test_a_failed_send_shows_as_auth_failed_and_can_be_retried(monkeypatch, applicant, reviewer, case):
    fake = FakeEngine(monkeypatch)
    fake.fail_submit = True
    assert applicant.post(f"/api/assessments/{case}/submit").json()["stage"] == "AUTH_FAILED"
    fake.fail_submit = False
    body = reviewer.post(f"/api/assessments/{case}/retry").json()
    assert body["stage"] == "AUTH_RUNNING" and body["run"]["attempt"] == 2


def test_a_send_that_breaks_before_reaching_the_engine_can_be_retried(monkeypatch, applicant, reviewer, case):
    fake = FakeEngine(monkeypatch)
    # A document missing from storage: the send fails before the engine is called.
    missing = EvidenceFile.objects.filter(qid="PC1").get()
    missing.file.storage.delete(missing.file.name)
    body = applicant.post(f"/api/assessments/{case}/submit").json()
    assert body["stage"] == "AUTH_FAILED" and fake.sent == []
    assert Submission.objects.get().status == "failed"
    assert reviewer.post(f"/api/assessments/{case}/retry").status_code == 200


def _engine_answering(monkeypatch, handler):
    import httpx

    monkeypatch.setattr(client, "_client", lambda: httpx.Client(base_url="http://engine.test", transport=httpx.MockTransport(handler)))


def _accept(request):
    import httpx

    request.read()  # the upload: every document is read here
    return httpx.Response(202, json={"request_id": "r1"})


def test_a_send_uploads_every_document_and_returns_the_request_id(monkeypatch, tmp_path):
    _engine_answering(monkeypatch, _accept)
    doc = tmp_path / "a.pdf"
    doc.write_bytes(PDF)
    with doc.open("rb") as fh:
        assert client.submit({"application_id": "X"}, [("a.pdf", fh, "application/pdf", "passport")]) == "r1"


def test_a_send_stops_once_the_upload_passes_its_deadline(monkeypatch, tmp_path):
    _engine_answering(monkeypatch, _accept)
    monkeypatch.setattr(client, "_upload_seconds", lambda: -1)  # already past it
    doc = tmp_path / "a.pdf"
    doc.write_bytes(PDF)
    with doc.open("rb") as fh, pytest.raises(EngineUnavailable):
        client.submit({"application_id": "X"}, [("a.pdf", fh, "application/pdf", "passport")])


def test_a_question_never_answered_is_checked_as_the_no_it_is_sent_as(monkeypatch, reviewer, applicant, case):
    fake = FakeEngine(monkeypatch)
    # PC19 was never answered, so it would go as No, which the settings no longer offer.
    pc19 = {"allowedAnswers": ["Yes"], "fileTypes": ["pdf"], "maxFiles": 1}
    was = make.label()
    assert reviewer.put("/api/questionnaire", {"department": "banking", "version": was, "questions": {"PC19": pc19}}).json()["version"] == make.label() != was
    response = applicant.post(f"/api/assessments/{case}/submit")
    assert response.status_code == 409 and "PC19" in response.json()["detail"] and fake.sent == []


def test_a_request_id_the_engine_already_gave_another_run_fails_the_send(monkeypatch, reviewer, applicant, case):
    fake = FakeEngine(monkeypatch)
    Submission.objects.create(
        assessment=make.assessment(), attempt_no=1, version=make.version_in_force(), payload={},
        engine_request_id="req1",
    )
    response = applicant.post(f"/api/assessments/{case}/submit")  # the fake answers "req1" again
    assert response.status_code == 200 and response.json()["stage"] == "AUTH_FAILED" and len(fake.sent) == 1


def test_an_engine_reported_failure_shows_as_auth_failed(monkeypatch, no_poll_delay, applicant, case, django_capture_on_commit_callbacks):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.status_doc = {"status": "FAILED", "error": "OCR crashed", "stages": {"authentication": "FAILED"}}
    with django_capture_on_commit_callbacks(execute=True):
        applicant.get(f"/api/assessments/{case}/case")
    assert stage(case) == Stage.AUTH_FAILED


# ---- Highlights and the audit trail ------------------------------------------------------------

def test_highlights_pass_through_after_the_access_check(monkeypatch, as_user, applicant, case, flagged):
    class Upstream:
        def iter_bytes(self):
            yield b"%PDF-highlight"

    @contextmanager
    def highlight(request_id, name):
        yield Upstream() if name == "PC1_police_clearance_p1.pdf" else None

    monkeypatch.setattr(client, "highlight", highlight)
    response = applicant.get(f"/api/assessments/{case}/highlights/PC1_police_clearance_p1.pdf")
    assert response.status_code == 200 and b"".join(response.streaming_content) == b"%PDF-highlight"
    assert applicant.get(f"/api/assessments/{case}/highlights/missing.pdf").status_code == 404
    assert applicant.get(f"/api/assessments/{case}/highlights/..%2Fsecret.pdf").status_code == 404
    stranger = as_user(make.user("stranger@example.na"))
    assert stranger.get(f"/api/assessments/{case}/highlights/PC1_police_clearance_p1.pdf").status_code == 404


def test_every_step_is_audited(reviewer, case, flagged):
    send(reviewer, case, {"verdict": "rejected", "comment": "Need more."})
    actions = list(AuditEvent.objects.filter(assessment_ref=case).order_by("id").values_list("action", flat=True))
    assert actions[0] == "assessment.create"
    # The first ruling takes the case for the reviewer (case.claim) before it is recorded.
    assert actions[-5:] == ["case.submit", "case.review_pending", "case.claim", "case.rule", "case.returned_to_applicant"]


# ---- What a submission may carry ---------------------------------------------------------------

def test_a_resubmission_needs_new_evidence_for_each_rejected_answer(reviewer, applicant, case, flagged):
    send(reviewer, case, {"verdict": "rejected", "comment": "Need the court order."})
    flagged.status_doc = PENDING
    # Unchanged: the engine would only read the same document again.
    response = applicant.post(f"/api/assessments/{case}/resubmit")
    assert response.status_code == 409 and "Attach new evidence for PC1" in response.json()["detail"]
    # Removed without a replacement: the answer still needs a document.
    pc1 = EvidenceFile.objects.get(assessment__public_id=case, qid="PC1", superseded_at__isnull=True)
    assert applicant.delete(f"/api/assessments/{case}/evidence/{pc1.public_id}").status_code == 204
    response = applicant.post(f"/api/assessments/{case}/resubmit")
    assert response.status_code == 409 and "documents for PC1" in response.json()["detail"]
    assert stage(case) == Stage.AWAITING_APPLICANT and Submission.objects.count() == 1
    attach(applicant, case, "PC1", "POLICE_CLEARANCE")
    assert applicant.post(f"/api/assessments/{case}/resubmit").json()["stage"] == "AUTH_RUNNING"


def _questions(payload):
    return {q["qid"]: q for section in payload["sections"] for q in section["questions"]}


def _sections(payload):
    return {section["section"]: section for section in payload["sections"]}


def test_a_first_submission_says_it_is_the_first(monkeypatch, applicant, case):
    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    payload = fake.sent[0]["payload"]
    assert (payload["is_resubmission"], payload["submission_version"], payload["previous_submission_version"]) == (
        False, "v1", None,
    )
    assert payload["previous_request_id"] is None
    assert not any(section["resubmitted"] for section in payload["sections"])
    questions = _questions(payload)
    assert all(q["resubmitted"] is False and q["reviewer_review"] is None for q in questions.values())
    # Documents sent for the first time are v1; a question sending none has no version.
    assert questions["A1"]["evidence"] and questions["A1"]["evidence_version"] == "v1"
    assert all(q["evidence_version"] is None for q in questions.values() if not q["evidence"])


def test_a_resubmission_tells_the_engine_what_the_reviewer_ruled_and_what_changed(
    monkeypatch, no_poll_delay, reviewer, applicant, case
):
    # APP004's result, with A1 flagged as well as PC1: one to accept, one to send back.
    original = adapt.question_results
    monkeypatch.setattr(adapt, "question_results", lambda result: [
        {**r, "status": "issue" if r["qid"] == "A1" else r["status"]} for r in original(result)
    ])
    fake = FakeEngine(monkeypatch, "APP004-return")
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    assert sorted(applicant.get(f"/api/assessments/{case}/case").json()["flags"]) == ["A1", "PC1"]
    reviewer.put(f"/api/assessments/{case}/rulings/A1", {"verdict": "accepted", "comment": "Age confirmed on the ID."})
    reviewer.put(f"/api/assessments/{case}/rulings/PC1", {"verdict": "rejected", "comment": "Need the court order."})
    assert reviewer.post(f"/api/assessments/{case}/complete-review").json()["stage"] == "AWAITING_APPLICANT"

    fake.status_doc = PENDING
    attach(applicant, case, "PC1", "POLICE_CLEARANCE")
    assert applicant.post(f"/api/assessments/{case}/resubmit").json()["stage"] == "AUTH_RUNNING"
    first, again = fake.sent[0]["payload"], fake.sent[1]["payload"]
    assert (again["is_resubmission"], again["submission_version"], again["previous_submission_version"]) == (
        True, "v2", "v1",
    )
    # The engine's id for the run the reviewer ruled on.
    ruled = Submission.objects.get(assessment__public_id=case, attempt_no=1)
    assert ruled.engine_request_id and again["previous_request_id"] == ruled.engine_request_id
    assert first["previous_request_id"] is None

    questions = _questions(again)
    # Sent back: marked, with the reviewer's word, and its new document is the second version.
    assert questions["PC1"]["resubmitted"] is True
    assert questions["PC1"]["reviewer_review"] == {"verdict": "rejected", "comment": "Need the court order."}
    assert questions["PC1"]["evidence_version"] == "v2"
    # Accepted by the reviewer: not resubmitted, but its review and comment still go; its
    # document is unchanged.
    assert questions["A1"]["resubmitted"] is False
    assert questions["A1"]["reviewer_review"] == {"verdict": "accepted", "comment": "Age confirmed on the ID."}
    assert questions["A1"]["evidence_version"] == "v1"
    # Not ruled on: false and no review, beside them in the same section too.
    assert questions["PC19"]["resubmitted"] is False and questions["PC19"]["reviewer_review"] is None

    sections = _sections(again)
    pc1_section = next(name for name, s in sections.items() if any(q["qid"] == "PC1" for q in s["questions"]))
    a1_section = next(name for name, s in sections.items() if any(q["qid"] == "A1" for q in s["questions"]))
    # A section is resubmitted when one of its questions is: PC1's is; A1's holds only an
    # accepted question, so every question in it is false, and so is the section.
    assert sections[pc1_section]["resubmitted"] is True and sections[a1_section]["resubmitted"] is False
    assert all(q["resubmitted"] is False for q in sections[a1_section]["questions"])
    for section in sections.values():
        assert section["resubmitted"] is any(q["resubmitted"] for q in section["questions"])
    untouched = [s for name, s in sections.items() if name not in (pc1_section, a1_section)]
    assert untouched and all(s["resubmitted"] is False for s in untouched)
    assert all(q["resubmitted"] is False and q["reviewer_review"] is None for s in untouched for q in s["questions"])

    # The case keeps each question's rulings, by run, for the breakdown's reviewer labels.
    history = reviewer.get(f"/api/assessments/{case}/case").json()["reviewHistory"]
    assert set(history) == {"A1", "PC1"}
    assert [(e["verdict"], e["run"], e["current"], e["scoreForced"]) for e in history["PC1"]] == [
        ("rejected", "v1", False, False),
    ]
    assert history["A1"][0]["comment"] == "Age confirmed on the ID." and history["A1"][0]["by"] == reviewer.user.email
    seen_by_applicant = applicant.get(f"/api/assessments/{case}/case").json()["reviewHistory"]
    assert seen_by_applicant["PC1"][0]["by"] is None and seen_by_applicant["PC1"][0]["comment"] == "Need the court order."

    # Everything the engine read before is still sent the same way.
    for key in ("application_id", "licensee", "applicant", "cv_verification"):
        assert again[key] == first[key]
    old_keys = {"qid", "question", "question_weight", "polarity", "knockout", "answer", "evidence_required",
                "evidence", "checks_to_perform"}
    assert all(old_keys <= set(q) for q in questions.values())


def test_a_case_never_submitted_has_no_review_history(reviewer, case):
    assert reviewer.get(f"/api/assessments/{case}/case").json()["reviewHistory"] == {}


def test_a_retried_run_is_not_counted_as_another_submission():
    from types import SimpleNamespace as Run

    def run(submitted_at, files=(), rulings=(), request_id=None):
        return Run(
            payload={"submitted_at": submitted_at},
            engine_request_id=request_id,
            evidence_files=Run(all=lambda: [Run(identity=sha, qid=qid) for qid, sha in files]),
            rulings=Run(all=lambda: [Run(qid=q, verdict=v, comment=c) for q, v, c in rulings]),
        )

    first = run("t1", files=[("PC1", "aa11")])  # its send failed: the engine gave it no id
    retried = run("t1", files=[("PC1", "aa11")], rulings=[("PC1", "rejected", "Court order.")], request_id="r-2")
    history = adapt.run_history([first, retried])
    assert history.version == 2  # the next submission is the second, not the third
    assert history.previous_request_id == "r-2"  # the run the engine completed and the reviewer ruled on
    assert history.reviews == {"PC1": {"verdict": "rejected", "comment": "Court order."}}
    assert history.sent == {"PC1": [frozenset({"aa11"})]}  # the same documents, one version


def test_documents_attached_under_older_settings_must_be_replaced_before_submitting(monkeypatch, reviewer, applicant, case):
    fake = FakeEngine(monkeypatch)
    # Published after the draft's PDF was attached: PC1 now takes images only.
    pc1 = {"allowedAnswers": ["Yes", "No"], "fileTypes": ["png"], "maxFiles": 1}
    was = make.label()
    assert reviewer.put("/api/questionnaire", {"department": "banking", "version": was, "questions": {"PC1": pc1}}).json()["version"] == make.label() != was
    response = applicant.post(f"/api/assessments/{case}/submit")
    assert response.status_code == 409
    assert "PC1 (.pdf no longer accepted)" in response.json()["detail"]
    assert fake.sent == [] and stage(case) == Stage.NOT_SUBMITTED


def test_a_missing_stored_file_is_not_found_rather_than_an_error(applicant, case):
    from django.core.files.storage import default_storage

    evidence = EvidenceFile.objects.filter(assessment__public_id=case, qid="A1").first()
    # Served while it exists (covered elsewhere); here the record outlives its file.
    default_storage.delete(evidence.file.name)
    assert applicant.get(f"/api/assessments/{case}/evidence/{evidence.public_id}/file").status_code == 404


def test_with_a_worker_following_runs_page_requests_never_call_the_engine(monkeypatch, settings, applicant, case):
    from cases import workflow

    settings.ENGINE_FOLLOW_IN_REQUESTS = False
    monkeypatch.setattr(workflow, "sync", lambda a: pytest.fail("a page request called the engine"))
    monkeypatch.setattr(workflow, "follow_due_runs", lambda *a, **k: pytest.fail("a page request called the engine"))
    assert applicant.get(f"/api/assessments/{case}/case").status_code == 200
    assert applicant.get("/api/assessments").status_code == 200


# ---- Engine documents in and out ---------------------------------------------------------------

def test_two_documents_of_one_type_under_one_question_each_keep_their_own_link():
    from cases.models import Assessment, EvidenceFile as Evidence

    assessment = Assessment(public_id="FNP-2026-0001")
    primary = Evidence(qid="FC5", doc_type="bank_statement", role="primary")
    supporting = Evidence(qid="FC5", doc_type="bank_statement", role="supporting")
    result = {"sections": [{"section": "Financial", "questions": [{
        "qid": "FC5", "question_status": "authenticated",
        "evidence_documents": [
            {"doc_type": "bank_statement", "role": "primary"},
            {"doc_type": "bank_statement", "role": "supporting"},
        ],
    }]}]}
    documents = adapt.authentication(assessment, result, [primary, supporting])["sections"][0]["questions"][0]["documents"]
    assert documents[0]["url"].endswith(f"{primary.public_id}/file")
    assert documents[1]["url"].endswith(f"{supporting.public_id}/file")


def test_files_opened_for_a_send_that_fails_partway_are_closed():
    from types import SimpleNamespace

    class Handle:
        closed = False

        def close(self):
            self.closed = True

    opened = Handle()

    def missing(mode):
        raise FileNotFoundError("gone")

    evidence = [
        SimpleNamespace(original_name="a.pdf", doc_type="national_id", content_type="application/pdf",
                        file=SimpleNamespace(open=lambda mode: opened)),
        SimpleNamespace(original_name="b.pdf", doc_type="cv", content_type="application/pdf",
                        file=SimpleNamespace(open=missing)),
    ]
    with pytest.raises(FileNotFoundError):
        adapt.submission_files(evidence)
    assert opened.closed


# ---- Following and sending runs ------------------------------------------------------------------

def test_a_run_still_being_sent_does_not_hold_up_the_others(monkeypatch, no_poll_delay, reviewer, applicant, case):
    from cases import workflow

    fake = FakeEngine(monkeypatch)
    applicant.post(f"/api/assessments/{case}/submit")
    # Another case mid-send: no engine id yet, and never polled, so it would sort first.
    other = make.assessment(applicant=make.user("other@example.na"), public_id="FNP-2026-0777", reference="R-777",
                            stage=Stage.AUTH_RUNNING)
    Submission.objects.create(assessment=other, attempt_no=1, version=other.version, payload={})
    fake.finish()
    assert workflow.follow_due_runs(1) == 1
    assert stage(case) == Stage.DECISION_PENDING  # the sent run moved on
    assert stage("FNP-2026-0777") == Stage.AUTH_RUNNING  # the one being sent was left alone


def test_a_send_the_engine_did_not_confirm_says_it_may_still_be_running(monkeypatch, applicant, case):
    from engine.client import EngineUnconfirmed

    FakeEngine(monkeypatch)
    monkeypatch.setattr(client, "submit", lambda payload, files: (_ for _ in ()).throw(EngineUnconfirmed("slow")))
    body = applicant.post(f"/api/assessments/{case}/submit").json()
    assert body["stage"] == "AUTH_FAILED" and body["run"]["unconfirmed"] is True
    assert "may still be processing it" in Submission.objects.get().error


def test_an_unknown_authentication_outcome_fails_the_run(monkeypatch, no_poll_delay, applicant, case, django_capture_on_commit_callbacks):
    fake = FakeEngine(monkeypatch, "APP004-return")
    result = engine_fixture("result-APP004-return.json")
    result["data_authentication_summary"]["outcome"] = "ERROR"
    monkeypatch.setattr(client, "result", lambda rid: result)
    applicant.post(f"/api/assessments/{case}/submit")
    fake.finish()
    with django_capture_on_commit_callbacks(execute=True):
        applicant.get(f"/api/assessments/{case}/case")
    assert stage(case) == Stage.AUTH_FAILED
    assert not Submission.objects.get().question_results.exists()  # nothing scored or flagged
    assert "'ERROR'" in Submission.objects.get().error


def test_a_retry_resends_the_failed_run_as_it_was(monkeypatch, applicant, case):
    fake = FakeEngine(monkeypatch)
    fake.fail_submit = True
    applicant.post(f"/api/assessments/{case}/submit")
    assert stage(case) == Stage.AUTH_FAILED
    first = Submission.objects.get()
    fake.fail_submit = False
    assert applicant.post(f"/api/assessments/{case}/retry").json()["stage"] == "AUTH_RUNNING"
    second = Submission.objects.get(attempt_no=2)
    assert second.payload == first.payload
    assert set(second.evidence_files.values_list("pk", flat=True)) == set(first.evidence_files.values_list("pk", flat=True))
    assert fake.sent[0]["payload"] == first.payload


def test_the_case_lists_rejected_answers_still_waiting_for_new_evidence(reviewer, applicant, case, flagged):
    body = send(reviewer, case, {"verdict": "rejected", "comment": "Court order."})
    assert body["unreplaced"] == ["PC1"]
    attach(applicant, case, "PC1", "POLICE_CLEARANCE")
    assert applicant.get(f"/api/assessments/{case}/case").json()["unreplaced"] == []


def test_a_highlight_stream_is_released_even_if_never_read():
    from cases.views.case import _UpstreamBody

    class Stream:
        exited = 0

        def __exit__(self, *exc):
            self.exited += 1

    stream = Stream()
    body = _UpstreamBody(stream, upstream=None)
    body.close()  # as Django does when the browser leaves before the first chunk
    body.close()
    assert stream.exited == 1


def test_a_score_the_app_calculated_itself_is_shown_with_its_source(reviewer):
    from decimal import Decimal

    from cases.models import Decision, QuestionnaireVersion

    assessment = make.assessment(stage=Stage.DECISION_PENDING)
    submission = Submission.objects.create(
        assessment=assessment, attempt_no=1, version=catalogue.active_version(assessment.department), payload={},
    )
    Score.objects.create(
        submission=submission, source="backend_override", risk_score=Decimal("32"), normalised=Decimal("0.32"),
        band="Elevated", knock_out=False, recommendation="Refer", lines=[],
    )
    url = f"/api/assessments/{assessment.public_id}/case"
    # Shown on an undecided case too, so the reviewer sees what is on record; its source says which.
    assert reviewer.get(url).json()["score"]["source"] == "backend_override"
    Decision.objects.create(assessment=assessment, verdict="accepted", remarks="On the old score.", reviewer=make.reviewer())
    type(assessment).objects.filter(pk=assessment.pk).update(stage=Stage.ACCEPTED)
    score = reviewer.get(url).json()["score"]
    assert score["source"] == "backend_override" and score["band"] == "Elevated"


def test_an_engine_evidence_link_with_trailing_characters_still_becomes_ours():
    a = make.assessment()
    base = "http://40.81.225.53:8000/authentication/evidence-highlight/5b4896aef3/CoI2_registry_p2.pdf"
    ours = f"/api/assessments/{a.public_id}/highlights/CoI2_registry_p2.pdf"
    assert adapt.highlight_url(a, base + "#page=2") == ours + "#page=2"
    assert adapt.highlight_url(a, base + "#page=2%22") == ours + "#page=2"
    # Still never a path outside the run's own folder.
    assert adapt.highlight_url(a, base + "#page=2/../../x.pdf") is None


# ---- Sending the review on --------------------------------------------------------------------

def test_rulings_alone_do_not_move_the_case_and_can_be_changed_until_it_is_sent(reviewer, case, flagged):
    body = reviewer.put(f"/api/assessments/{case}/rulings/PC1", ACCEPT).json()
    assert body["stage"] == "REVIEW_PENDING" and body["reviewOutcome"] == "accept" and flagged.forced == []
    # Changed to a rejection, then undone and accepted again: nothing is sent meanwhile.
    body = reviewer.put(f"/api/assessments/{case}/rulings/PC1", {"verdict": "rejected", "comment": "Hm."}).json()
    assert body["reviewOutcome"] == "return"
    assert reviewer.delete(f"/api/assessments/{case}/rulings/PC1").json()["reviewOutcome"] is None
    reviewer.put(f"/api/assessments/{case}/rulings/PC1", ACCEPT)
    assert flagged.forced == [] and stage(case) == Stage.REVIEW_PENDING
    # Sent on: undoing is no longer possible.
    reviewer.post(f"/api/assessments/{case}/complete-review")
    assert reviewer.delete(f"/api/assessments/{case}/rulings/PC1").status_code == 409


def test_the_review_cannot_be_sent_while_a_flag_waits_for_a_ruling(applicant, reviewer, case, flagged):
    from cases.models import QuestionResult

    QuestionResult.objects.filter(qid="A1").update(status="issue")
    reviewer.put(f"/api/assessments/{case}/rulings/PC1", ACCEPT)
    response = reviewer.post(f"/api/assessments/{case}/complete-review")
    assert response.status_code == 409 and "every flagged answer" in response.json()["detail"]
    assert applicant.post(f"/api/assessments/{case}/complete-review").status_code == 403
    assert flagged.forced == [] and stage(case) == Stage.REVIEW_PENDING


def test_returning_to_the_applicant_does_not_call_the_engine(applicant, reviewer, case, flagged):
    body = send(reviewer, case, {"verdict": "rejected", "comment": "Upload the court order."})
    assert body["stage"] == "AWAITING_APPLICANT" and flagged.forced == []
    # The applicant sees the reviewer's comment on the rejected answer.
    seen = applicant.get(f"/api/assessments/{case}/case").json()
    assert seen["rejected"] == ["PC1"] and seen["rulings"]["PC1"]["comment"] == "Upload the court order."


def test_the_review_is_sent_once(reviewer, case, flagged):
    send(reviewer, case, ACCEPT)
    assert reviewer.post(f"/api/assessments/{case}/complete-review").status_code == 409
    assert flagged.forced == [("req1", case)]


# ---- Forcing the score: interruptions, repeats and stale stages -------------------------------

def test_a_force_request_that_never_reaches_the_engine_is_given_up_after_a_while(
    monkeypatch, reviewer, case, flagged, django_capture_on_commit_callbacks
):
    from cases import workflow

    # The process stops after the case moved to SCORING but before the engine call.
    monkeypatch.setattr(workflow, "_request_forced_score", lambda assessment, actor: None)
    body = send(reviewer, case, ACCEPT)
    assert body["stage"] == "SCORING" and body["run"]["status"] == "running"  # followed, not orphaned
    # Within the wait it stays in scoring; after it, the case returns to the decision.
    assert reviewer.get(f"/api/assessments/{case}/case").json()["stage"] == "SCORING"
    Submission.objects.update(score_forced_at=timezone.now() - datetime.timedelta(minutes=10), last_polled_at=None)
    with django_capture_on_commit_callbacks(execute=True):
        reviewer.get(f"/api/assessments/{case}/case")
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING" and body["score"] is None
    assert "did not start scoring" in body["run"]["forceScoreError"] and body["run"]["canForceScore"] is True
    assert body["run"]["scoreForced"] is False


def test_a_second_force_request_is_refused_while_the_first_one_runs(reviewer, case, flagged):
    send(reviewer, case, ACCEPT)
    assert reviewer.post(f"/api/assessments/{case}/force-score").status_code == 409
    assert flagged.forced == [("req1", case)]


def test_a_finished_forced_run_is_not_reopened(reviewer, case, flagged):
    send(reviewer, case, ACCEPT)
    flagged.finish_forced()
    assert reviewer.get(f"/api/assessments/{case}/case").json()["stage"] == "DECISION_PENDING"
    assert reviewer.post(f"/api/assessments/{case}/force-score").status_code == 409
    run = Submission.objects.get()
    assert run.status == "completed" and flagged.forced == [("req1", case)]


def _forced_status(forced_at, completed_at, score="NOT_PRODUCED", assessment="NOT_PRODUCED"):
    doc = engine_fixture("status-APP004-return.json")
    return {**doc, "outcome": "CLEAR", "score_forced": True, "score_forced_at": forced_at,
            "completed_at": completed_at, "stages": {"authentication": "READY", "score": score, "assessment": assessment}}


def test_stages_left_from_the_original_run_do_not_end_a_forced_run(reviewer, case, flagged):
    send(reviewer, case, ACCEPT)
    # The engine already reports CLEAR, but its stages and completion are still the original run's.
    flagged.status_doc = _forced_status("2026-10-14T10:00:00+00:00", "2026-10-14T09:00:00+00:00")
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "SCORING" and body["run"]["forceScoreError"] is None
    # Completed after it was forced, and still not produced: then it really was not scored.
    flagged.status_doc = _forced_status("2026-10-14T10:00:00+00:00", "2026-10-14T10:02:00+00:00")
    Submission.objects.update(last_polled_at=None)
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING" and body["score"] is None
    assert body["run"]["forceScoreError"] == "The AI engine did not produce a score."


def test_an_engine_score_replaces_one_the_app_calculated_itself(reviewer, case, flagged):
    from decimal import Decimal

    from cases.models import Assessment, Ruling

    run = Submission.objects.get()
    Ruling.objects.create(submission=run, qid="PC1", verdict="accepted", comment="ok", reviewer=make.reviewer())
    Assessment.objects.filter(public_id=case).update(stage=Stage.DECISION_PENDING)
    Score.objects.create(
        submission=run, source="backend_override", risk_score=Decimal("32"), normalised=Decimal("0.32"),
        band="Elevated", knock_out=False, recommendation="Refer", lines=[],
    )
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["score"]["source"] == "backend_override" and body["run"]["canForceScore"] is True
    assert reviewer.post(f"/api/assessments/{case}/force-score").json()["stage"] == "SCORING"
    flagged.finish_forced()
    body = reviewer.get(f"/api/assessments/{case}/case").json()
    assert body["stage"] == "DECISION_PENDING" and body["score"]["source"] == "engine"
    assert Score.objects.count() == 1



def test_the_case_page_reads_its_run_once(reviewer, applicant, case, flagged):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    def get(user):
        with CaptureQueriesContext(connection) as queries:
            body = user.get(f"/api/assessments/{case}/case").json()
        runs = [q for q in queries if 'FROM "submission"' in q["sql"] and '"submission"."attempt_no"' in q["sql"]]
        return body, len(queries), len(runs)

    reviewer.put(f"/api/assessments/{case}/rulings/PC1", {"verdict": "rejected", "comment": "Need the court order."})
    body, under_review, runs = get(reviewer)
    assert body["reviewOutcome"] == "return" and body["rulings"]["PC1"]["verdict"] == "rejected"
    assert under_review <= 7
    assert runs == 1, "the latest run is read once"
    reviewer.post(f"/api/assessments/{case}/complete-review")
    body, returned, runs = get(applicant)
    assert body["stage"] == "AWAITING_APPLICANT" and body["rejected"] == ["PC1"] and body["unreplaced"] == ["PC1"]
    assert returned <= 8
    assert runs == 1, "the latest run is read once"


def test_following_a_run_being_scored_does_not_read_its_saved_documents(monkeypatch, no_poll_delay, applicant, case):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    from cases import workflow
    from cases.models import Assessment

    fake = FakeEngine(monkeypatch, "APP001-clear")
    applicant.post(f"/api/assessments/{case}/submit")
    scoring = engine_fixture("status-APP001-clear.json")
    scoring["stages"] = {**scoring["stages"], "score": "PENDING", "assessment": "PENDING"}
    fake.status_doc = scoring
    assessment = Assessment.objects.get(public_id=case)
    workflow.sync(assessment)
    assessment.refresh_from_db()
    assert assessment.stage == Stage.SCORING
    with CaptureQueriesContext(connection) as queries:
        workflow.sync(assessment)
    # The saved authentication report (tens of KB) is neither read nor rewritten while scoring.
    # (Only whether it is saved is asked: "authentication" IS NOT NULL.)
    read = re.compile(r'"submission_document"\."authentication"(?! IS NOT NULL)')
    assert not [q for q in queries if read.search(q["sql"])]
    assert not [q for q in queries if '"submission"."payload"' in q["sql"]]
    fake.finish()
    workflow.sync(assessment)
    assessment.refresh_from_db()
    assert assessment.stage == Stage.DECISION_PENDING and Score.objects.get().source == "engine"

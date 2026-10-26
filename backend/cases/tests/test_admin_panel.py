"""The reviewer's admin panel API: who may read it, what it counts, and what it leaves out."""

import datetime

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from cases import audit
from cases.models import ApplicantProfile, Assessment, Decision, Stage, Submission, User
from cases.tests import factories as make

pytestmark = pytest.mark.django_db

ENDPOINTS = ("/api/admin/overview", "/api/admin/users")


@pytest.fixture
def reviewer(as_user):
    return as_user(make.reviewer())


@pytest.fixture
def population():
    """Three applicants (one deactivated, one joined long ago) and their assessments."""
    anna = make.user("anna@example.na")
    ben = make.user("ben@example.na")
    old = make.user("old.timer@example.na")
    User.objects.filter(pk=old.pk).update(created_at=timezone.now() - datetime.timedelta(days=60), is_active=False)
    make.assessment(applicant=anna, public_id="FNP-2026-0001", reference="R-1")
    review = make.assessment(applicant=anna, public_id="FNP-2026-0002", reference="R-2", stage=Stage.REVIEW_PENDING)
    decided = make.assessment(applicant=ben, public_id="FNP-2026-0003", reference="R-3", stage=Stage.ACCEPTED)
    Decision.objects.create(assessment=decided, verdict="accepted", remarks="Fine.", reviewer=make.reviewer())
    ApplicantProfile.objects.create(assessment=review, national_id_number="72012700462", phone="+264 81 000 0101")
    return {"anna": anna, "ben": ben, "old": old}


def test_only_the_reviewer_may_read_the_admin_panel(as_user, population):
    applicant = as_user(population["anna"])
    for path in (*ENDPOINTS, f"/api/admin/users/{population['ben'].pk}"):
        assert applicant.get(path).status_code == 403
        assert APIClient().get(path).status_code == 401


def test_the_overview_counts_the_whole_system(reviewer, population):
    body = reviewer.get("/api/admin/overview").json()
    # Three applicants plus the reviewer.
    assert body["users"] == {
        "total": 4, "applicants": 3, "reviewers": 1, "admins": 0, "superUsers": 1, "active": 3, "inactive": 1,
        "newRecently": 3, "signedInRecently": 1,  # the reviewer, signed in by the test client
    }
    assessments = body["assessments"]
    assert assessments["total"] == 3 and assessments["awaitingReviewer"] == 1
    assert (assessments["accepted"], assessments["rejected"]) == (1, 0)
    assert assessments["byStage"]["NOT_SUBMITTED"] == 1 and assessments["byStage"]["REJECTED"] == 0
    assert set(assessments["byStage"]) == set(Stage.values)
    banking = next(d for d in assessments["byDepartment"] if d["key"] == "banking")
    assert banking["count"] == 3
    assert body["runs"] == {"inProgress": 0, "failed": 0}
    assert body["documents"] == {"count": 0, "bytes": 0}


def test_the_user_list_searches_filters_and_pages(reviewer, population):
    body = reviewer.get("/api/admin/users").json()
    assert body["total"] == 4 and body["next"] is None
    anna = next(u for u in body["results"] if u["email"] == "anna@example.na")
    assert anna["assessmentCount"] == 2 and anna["role"] == "applicant" and anna["isActive"] is True
    assert anna["latestStage"] in {Stage.NOT_SUBMITTED, Stage.REVIEW_PENDING}

    assert [u["email"] for u in reviewer.get("/api/admin/users", search="BEN").json()["results"]] == ["ben@example.na"]
    assert reviewer.get("/api/admin/users", role="reviewer").json()["total"] == 1
    inactive = reviewer.get("/api/admin/users", status="inactive").json()["results"]
    assert [u["email"] for u in inactive] == ["old.timer@example.na"]
    for bad in ({"role": "boss"}, {"status": "gone"}, {"page": "0"}, {"page": "x"}):
        assert reviewer.get("/api/admin/users", **bad).status_code == 400


def test_the_user_list_pages_with_a_fixed_number_of_queries(reviewer):
    with CaptureQueriesContext(connection) as few:
        reviewer.get("/api/admin/users")
    for i in range(55):
        make.assessment(applicant=make.user(f"u{i}@example.na"), public_id=f"FNP-2026-{i:04d}", reference=f"P-{i}")
    with CaptureQueriesContext(connection) as many:
        first = reviewer.get("/api/admin/users").json()
    assert len(many) == len(few)
    assert len(first["results"]) == 50 and first["next"] == "2" and first["total"] == 56
    second = reviewer.get("/api/admin/users", page=first["next"]).json()
    assert len(second["results"]) == 6 and second["next"] is None
    assert len({u["id"] for u in first["results"] + second["results"]}) == 56


def test_a_users_detail_lists_their_assessments_and_activity_but_no_personal_details(reviewer, population):
    anna = population["anna"]
    audit.record(anna, "session.sign_in")
    body = reviewer.get(f"/api/admin/users/{anna.pk}").json()
    assert body["email"] == "anna@example.na"
    assert {a["id"] for a in body["assessments"]} == {"FNP-2026-0001", "FNP-2026-0002"}
    assert body["activity"][0]["action"] == "session.sign_in"
    text = str(body)
    assert "72012700462" not in text and "+264" not in text and "dateOfBirth" not in text
    assert reviewer.get("/api/admin/users/999999").status_code == 404


def test_a_users_detail_gives_each_assessments_latest_request_id(reviewer, population):
    anna = population["anna"]
    resubmitted = Assessment.objects.get(public_id="FNP-2026-0002")
    for n, request_id in ((1, "req-first"), (2, "req-second")):
        Submission.objects.create(
            assessment=resubmitted, attempt_no=n, version=resubmitted.version, payload={}, engine_request_id=request_id
        )
    rows = {a["id"]: a for a in reviewer.get(f"/api/admin/users/{anna.pk}").json()["assessments"]}
    # A draft: never sent, so no ID.
    assert (rows["FNP-2026-0001"]["requestId"], rows["FNP-2026-0001"]["runCount"]) == (None, 0)
    assert rows["FNP-2026-0001"]["runStatus"] is None
    # Resubmitted: the latest run's ID, and how many runs there were.
    assert (rows["FNP-2026-0002"]["requestId"], rows["FNP-2026-0002"]["runCount"]) == ("req-second", 2)

    # Sent, but the engine has not given it an ID yet.
    waiting = make.assessment(applicant=anna, public_id="FNP-2026-0009", reference="R-9", stage=Stage.AUTH_RUNNING)
    Submission.objects.create(assessment=waiting, attempt_no=1, version=waiting.version, payload={})
    row = next(a for a in reviewer.get(f"/api/admin/users/{anna.pk}").json()["assessments"] if a["id"] == "FNP-2026-0009")
    assert (row["requestId"], row["runCount"], row["runStatus"]) == (None, 1, "queued")


def test_a_users_detail_runs_a_fixed_number_of_queries(reviewer):
    applicant = make.user("many@example.na")
    make.assessment(applicant=applicant, public_id="FNP-2026-0100", reference="Q-0")
    with CaptureQueriesContext(connection) as few:
        reviewer.get(f"/api/admin/users/{applicant.pk}")
    for i in range(1, 8):
        case = make.assessment(applicant=applicant, public_id=f"FNP-2026-01{i:02d}", reference=f"Q-{i}")
        Submission.objects.create(assessment=case, attempt_no=1, version=case.version, payload={}, engine_request_id=f"r{i}")
    with CaptureQueriesContext(connection) as many:
        body = reviewer.get(f"/api/admin/users/{applicant.pk}").json()
    assert len(many) == len(few) and len(body["assessments"]) == 8

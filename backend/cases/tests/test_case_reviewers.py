"""Several admins in one department: the first to take a submitted case reviews it; the others read
it. Every step is checked on the case's locked row, so two admins acting at once never both act."""

import pytest

from cases.models import AuditEvent, QuestionResult, Role, Ruling, Stage, Submission, User
from cases.tests import factories as make

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]


@pytest.fixture
def anna(as_user):
    return as_user(make.admin("anna@example.na", ("banking",)))


@pytest.fixture
def ben(as_user):
    return as_user(make.admin("ben@example.na", ("banking",)))


@pytest.fixture
def super_user(as_user):
    return as_user(make.reviewer())


def under_review(public_id="FNP-2026-0700", stage=Stage.REVIEW_PENDING, **fields):
    """A submitted banking case whose run flagged PC1 and Q1."""
    case = make.assessment(public_id=public_id, reference=f"BL-{public_id}", stage=stage, **fields)
    run = Submission.objects.create(assessment=case, attempt_no=1, version=case.version, payload={})
    for qid in ("PC1", "Q1"):
        QuestionResult.objects.create(submission=run, qid=qid, status="issue")
    return case


def rule(client, case, qid="PC1", verdict="accepted"):
    return client.put(f"/api/assessments/{case.public_id}/rulings/{qid}", {"verdict": verdict, "comment": "Checked."})


def test_the_first_admin_to_act_reviews_the_case_and_the_other_is_told(anna, ben):
    case = under_review()
    assert anna.get(f"/api/assessments/{case.public_id}/case").json()["reviewer"] is None
    assert rule(anna, case).status_code == 200  # her first step takes it
    case.refresh_from_db()
    assert case.reviewer.email == "anna@example.na" and case.claimed_at is not None
    # Ben reads it, but his ruling is refused: Anna's is never overwritten.
    seen = ben.get(f"/api/assessments/{case.public_id}/case").json()
    assert seen["reviewer"]["email"] == "anna@example.na"
    refused = rule(ben, case, verdict="rejected")
    assert refused.status_code == 409 and "anna@example.na is reviewing this case" in refused.json()["detail"]
    assert Ruling.objects.get(qid="PC1").verdict == "accepted"
    for path, method in (("rulings/PC1", "delete"), ("complete-review", "post")):
        assert getattr(ben, method)(f"/api/assessments/{case.public_id}/{path}").status_code == 409


def test_taking_releasing_and_taking_over(anna, ben, super_user):
    case = under_review()
    url = f"/api/assessments/{case.public_id}/claim"
    assert anna.post(url).json()["reviewer"]["email"] == "anna@example.na"
    assert anna.post(url).status_code == 200  # taking one's own again changes nothing
    refused = ben.post(url, {"takeOver": True})  # only the super user takes over
    assert refused.status_code == 409 and "anna@example.na" in refused.json()["detail"]
    assert ben.delete(url).status_code == 409  # nor can he release hers
    assert anna.delete(url).json()["reviewer"] is None
    assert ben.post(url).json()["reviewer"]["email"] == "ben@example.na"
    # The super user takes it over, saying so.
    assert super_user.post(url).status_code == 409
    assert super_user.post(url, {"takeOver": True}).json()["reviewer"]["email"] == "admin"
    events = list(AuditEvent.objects.filter(assessment_ref=case.public_id).values_list("action", flat=True))
    assert events == ["case.claim", "case.release", "case.claim", "case.claim"]


def test_only_a_submitted_undecided_case_can_be_taken(anna):
    for stage in (Stage.NOT_SUBMITTED, Stage.ACCEPTED):
        case = make.assessment(public_id=f"FNP-2026-07{len(stage)}", reference=f"R-{stage}", stage=stage)
        assert anna.post(f"/api/assessments/{case.public_id}/claim").status_code == 409


def test_nobody_reviews_their_own_application(as_user):
    anna_account = make.admin("anna@example.na", ("banking",))
    case = under_review(applicant=anna_account)
    refused = as_user(anna_account).post(f"/api/assessments/{case.public_id}/claim")
    assert refused.status_code == 403


def test_the_super_user_gives_a_case_to_an_admin_of_its_department(super_user, anna):
    make.admin("ins@example.na", ("insurance",))
    case = under_review()
    people = super_user.get(f"/api/assessments/{case.public_id}/assign").json()
    assert {p["email"] for p in people} == {"admin", "anna@example.na"}
    anna_id = User.objects.get(email="anna@example.na").pk
    given = super_user.post(f"/api/assessments/{case.public_id}/assign", {"userId": anna_id}).json()
    assert given["reviewer"]["email"] == "anna@example.na"
    other = User.objects.get(email="ins@example.na").pk
    refused = super_user.post(f"/api/assessments/{case.public_id}/assign", {"userId": other})
    assert refused.status_code == 409 and "does not work on Banking Licence" in refused.json()["detail"]
    assert anna.post(f"/api/assessments/{case.public_id}/assign", {"userId": anna_id}).status_code == 403
    event = AuditEvent.objects.get(action="case.assign")
    assert event.actor.email == "admin" and event.metadata["to"] == "anna@example.na"


def test_a_decision_is_made_only_by_the_reviewer(anna, ben):
    case = under_review(stage=Stage.DECISION_PENDING)
    anna.post(f"/api/assessments/{case.public_id}/claim")
    refused = ben.post(f"/api/assessments/{case.public_id}/decision", {"verdict": "accepted", "remarks": "Fine."})
    assert refused.status_code == 409
    assert anna.post(f"/api/assessments/{case.public_id}/decision", {"verdict": "accepted", "remarks": "Fine."}).status_code == 200


def test_losing_access_gives_the_cases_back(super_user, anna):
    case = under_review()
    anna.post(f"/api/assessments/{case.public_id}/claim")
    anna_id = User.objects.get(email="anna@example.na").pk
    detail = super_user.get(f"/api/admin/users/{anna_id}").json()
    assert detail["reviewing"] == 1
    body = super_user.patch(f"/api/admin/users/{anna_id}", {"departments": ["insurance"]}).json()
    assert body["released"] == 1 and body["reviewing"] == 0
    case.refresh_from_db()
    assert case.reviewer is None
    release = AuditEvent.objects.get(action="case.release")
    assert release.metadata == {"from": "anna@example.na", "reason": "access changed"}


def test_switching_an_admin_off_gives_their_cases_back(super_user, anna):
    case = under_review()
    anna.post(f"/api/assessments/{case.public_id}/claim")
    anna_id = User.objects.get(email="anna@example.na").pk
    assert super_user.patch(f"/api/admin/users/{anna_id}", {"isActive": False}).json()["released"] == 1
    case.refresh_from_db()
    assert case.reviewer is None


def test_the_queue_says_who_has_each_case_and_filters_by_it(anna, ben, as_user):
    mine, theirs, free = under_review("FNP-2026-0701"), under_review("FNP-2026-0702"), under_review("FNP-2026-0703")
    anna.post(f"/api/assessments/{mine.public_id}/claim")
    ben.post(f"/api/assessments/{theirs.public_id}/claim")
    body = anna.get("/api/assessments").json()
    holders = {a["id"]: (a["reviewer"] or {}).get("email") for a in body["results"]}
    assert holders == {mine.public_id: "anna@example.na", theirs.public_id: "ben@example.na", free.public_id: None}
    # Waiting on Anna: hers and the one nobody has; Ben's waits on Ben.
    assert body["actionable"] == 2
    assert [a["id"] for a in anna.get("/api/assessments", holder="mine").json()["results"]] == [mine.public_id]
    assert [a["id"] for a in anna.get("/api/assessments", holder="none").json()["results"]] == [free.public_id]
    assert anna.get("/api/assessments", holder="everyone").status_code == 400


def test_an_applicant_never_sees_who_reviews_their_case(anna, as_user):
    owner = make.user("owner@example.na")
    case = under_review(applicant=owner)
    anna.post(f"/api/assessments/{case.public_id}/claim")
    applicant = as_user(owner)
    assert "reviewer" not in applicant.get(f"/api/assessments/{case.public_id}/case").json()
    assert "reviewer" not in applicant.get(f"/api/assessments/{case.public_id}").json()


def test_cases_under_way_go_to_whoever_ruled_on_them_last():
    from importlib import import_module

    from django.apps import apps
    from django.db import connection

    migration = import_module("cases.migrations.0016_case_reviewers")
    anna_account = make.admin("anna@example.na", ("banking",))
    gone = make.admin("gone@example.na", ("insurance",))
    ruled = under_review("FNP-2026-0710")
    Ruling.objects.create(submission=ruled.submissions.get(), qid="PC1", verdict="accepted", comment="x", reviewer=anna_account)
    elsewhere = under_review("FNP-2026-0711")
    Ruling.objects.create(submission=elsewhere.submissions.get(), qid="PC1", verdict="accepted", comment="x", reviewer=gone)
    untouched = under_review("FNP-2026-0712")
    with connection.schema_editor() as editor:
        migration.give_cases_their_reviewers(apps, editor)
    for case in (ruled, elsewhere, untouched):
        case.refresh_from_db()
    assert ruled.reviewer == anna_account
    assert elsewhere.reviewer is None  # the one who ruled no longer works on banking
    assert untouched.reviewer is None


# ---- Other moments two things happen at once -------------------------------------------------

def test_a_switched_off_department_still_reviews_and_decides_what_it_has(super_user, anna):
    case = under_review(stage=Stage.DECISION_PENDING)
    super_user.patch("/api/admin/departments/banking", {"isActive": False})
    decided = anna.post(f"/api/assessments/{case.public_id}/decision", {"verdict": "accepted", "remarks": "Fine."})
    assert decided.status_code == 200 and decided.json()["stage"] == "ACCEPTED"


def test_the_form_says_which_questions_it_is_on(super_user, as_user):
    from cases.tests.test_questionnaire_edit import new_question, structure

    applicant = as_user(make.user("owner@example.na"))
    created = applicant.post("/api/assessments", {
        "applicantName": "Owner", "entity": "E", "position": "P", "reference": "BL-FORM-1", "department": "banking",
    }).json()["id"]
    before = applicant.get(f"/api/assessments/{created}/form").json()["version"]
    assert before == applicant.get("/api/catalogue", assessment=created).json()["version"]
    body = structure(super_user)
    body["sections"][-1]["questions"].append(new_question("Has the applicant served on a board abroad?"))
    assert super_user.put("/api/questionnaire", body).status_code == 200
    # The open form now reports the new edition, and its catalogue serves it.
    after = applicant.get(f"/api/assessments/{created}/form").json()
    assert after["version"] != before and "N1" in [a["qid"] for a in after["answers"]]
    assert applicant.get("/api/catalogue", assessment=created).json()["version"] == after["version"]
    # A save to a question since deleted is refused for that question only, by name.
    refused = applicant.patch(f"/api/assessments/{created}/form", {"answers": {"ZZ9": "Yes"}})
    assert refused.status_code == 400 and refused.json()["answers.ZZ9"] == "Unknown question."


# ---- Review round: codes, who decided, query counts --------------------------------------------

def test_a_refusal_over_who_reviews_carries_a_code(anna, ben):
    case = under_review()
    anna.post(f"/api/assessments/{case.public_id}/claim")
    body = rule(ben, case).json()
    assert body["code"] == "held_by_other" and "anna@example.na" in body["detail"]


def test_the_decision_says_who_made_it(anna, ben):
    case = under_review(stage=Stage.DECISION_PENDING)
    anna.post(f"/api/assessments/{case.public_id}/decision", {"verdict": "accepted", "remarks": "Fine."})
    # Even with no reviewer recorded on the case (as for cases decided before admins took them).
    type(case).objects.filter(pk=case.pk).update(reviewer=None)
    seen = ben.get(f"/api/assessments/{case.public_id}/case").json()
    assert seen["decision"]["by"] == "anna@example.na"


def test_who_a_case_can_be_given_to_is_read_in_a_fixed_number_of_queries(super_user):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    case = under_review()
    for i in range(3):
        make.admin(f"a{i}@example.na", ("banking",))
    with CaptureQueriesContext(connection) as few:
        super_user.get(f"/api/assessments/{case.public_id}/assign")
    for i in range(3, 13):
        make.admin(f"a{i}@example.na", ("banking",))
    with CaptureQueriesContext(connection) as many:
        people = super_user.get(f"/api/assessments/{case.public_id}/assign").json()
    assert len(people) == 14 and len(many) == len(few)


def test_released_cases_come_to_the_top_of_the_queue(super_user, anna):
    case = under_review()
    anna.post(f"/api/assessments/{case.public_id}/claim")
    type(case).objects.filter(pk=case.pk).update(updated_at="2020-01-01T00:00:00Z")
    anna_id = User.objects.get(email="anna@example.na").pk
    super_user.patch(f"/api/admin/users/{anna_id}", {"departments": ["insurance"]})
    case.refresh_from_db()
    assert case.reviewer is None and case.updated_at.year > 2020


def test_the_super_users_attention_count_leaves_out_another_admins_cases(super_user, anna):
    held, free = under_review("FNP-2026-0720"), under_review("FNP-2026-0721")
    anna.post(f"/api/assessments/{held.public_id}/claim")
    assert super_user.get("/api/assessments").json()["actionable"] == 1


def test_without_an_admin_account_the_reviewers_become_super_users():
    from importlib import import_module

    from django.apps import apps

    migration = import_module("cases.migrations.0014_roles_and_department_questionnaires")
    reviewer = make.user("real.reviewer@example.na", Role.REVIEWER)
    migration.give_roles(apps.get_model("cases", "User"), apps.get_model("cases", "Department"))
    reviewer.refresh_from_db()
    assert reviewer.role == Role.SUPERUSER


# ---- Review round: the account as it is now, not as the request found it ------------------------

def test_a_case_is_not_given_to_someone_who_has_just_lost_its_department():
    from cases import workflow

    anna_account = make.admin("anna@example.na", ("banking",))
    anna_account.department_ids()  # as a request would have read them, a moment before
    anna_account.departments.clear()  # the super user takes banking away meanwhile
    case = under_review()
    with pytest.raises(workflow.TransitionError, match="no longer work on Banking Licence"):
        workflow.claim(case, anna_account)
    case.refresh_from_db()
    assert case.reviewer is None


def test_sending_ones_own_failed_application_again_does_not_review_it(monkeypatch):
    from cases import workflow
    from cases.tests.test_workflow import FakeEngine

    FakeEngine(monkeypatch)
    anna_account = make.admin("anna@example.na", ("banking",))
    case = under_review(stage=Stage.AUTH_FAILED, applicant=anna_account)
    workflow.retry(case, anna_account)
    case.refresh_from_db()
    assert case.reviewer is None


def test_a_switched_off_admin_is_not_counted_as_a_departments_admin(super_user):
    make.admin("anna@example.na", ("banking",))
    off = make.admin("off@example.na", ("banking",))
    User.objects.filter(pk=off.pk).update(is_active=False)
    banking = next(d for d in super_user.get("/api/admin/departments").json() if d["key"] == "banking")
    assert banking["adminCount"] == 1


def test_an_admin_cannot_remove_a_case_another_admin_has_taken(anna, ben, super_user):
    """Removing a case is acting on it: only the admin reviewing it, or the super user, may."""
    case = under_review()
    assert anna.post(f"/api/assessments/{case.public_id}/claim").status_code == 200

    def removable(client):
        return next(a for a in client.get("/api/assessments").json()["results"] if a["id"] == case.public_id)["removable"]

    assert removable(anna) is True and removable(ben) is False and removable(super_user) is True
    refused = ben.delete(f"/api/assessments/{case.public_id}")
    assert refused.status_code == 409 and "Another admin is reviewing" in refused.json()["detail"]
    assert super_user.delete(f"/api/assessments/{case.public_id}").status_code == 204


def test_an_untaken_case_is_still_removed_by_any_admin_of_its_department(ben):
    case = under_review(public_id="FNP-2026-0701")
    assert ben.delete(f"/api/assessments/{case.public_id}").status_code == 204

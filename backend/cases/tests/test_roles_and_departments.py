"""The super user, department admins and users; each department with its own questionnaire."""

import pytest
from django.contrib.sessions.models import Session
from rest_framework.test import APIClient

from cases import catalogue
from cases.models import AuditEvent, Department, Question, QuestionnaireVersion, Role, Stage, User
from cases.tests import factories as make
from cases.tests.test_questionnaire_edit import new_question, structure

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]


@pytest.fixture(autouse=True)
def _every_department_has_questions(db):
    """Each department set up with banking's questions, unless a test empties one itself."""
    make.questions_for()

NEW = {
    "applicantName": "Anna M. Nghipandulwa", "email": "anna@example.na", "entity": "Namib Trust Bank Limited",
    "position": "Non-Executive Director", "reference": "BL-2026-0510", "initiatedOn": "2026-10-01",
    "department": "banking",
}
OWN = {k: v for k, v in NEW.items() if k not in ("email", "initiatedOn")}


@pytest.fixture
def super_user(as_user):
    return as_user(make.reviewer())


@pytest.fixture
def banking_admin(as_user):
    return as_user(make.admin("bank.admin@example.na", ("banking",)))


@pytest.fixture
def cases():
    """A submitted case in banking and one in insurance."""
    insurance = Department.objects.get(key="insurance")
    return {
        "banking": make.assessment(stage=Stage.REVIEW_PENDING),
        "insurance": make.assessment(
            public_id="FNP-2026-0002", reference="IS-2026-0002", stage=Stage.REVIEW_PENDING, department=insurance,
        ),
    }


# ---- Starting point: nothing changes ------------------------------------------------------------

def test_every_department_has_a_questionnaire_of_its_own():
    published = QuestionnaireVersion.objects.filter(department__isnull=True).order_by("pk").first()
    model = [(q.qid, q.text, q.weight, q.section.name) for q in Question.objects.filter(version=published).order_by("position")]
    for department in Department.objects.all():
        version = catalogue.active_version(department)
        assert version.department_id == department.pk
        copy = [(q.qid, q.text, q.weight, q.section.name) for q in Question.objects.filter(version=version).order_by("position")]
        assert copy == model
    assert len({catalogue.active_version(d).pk for d in Department.objects.all()}) == Department.objects.count()


def test_the_built_in_admin_is_the_super_user(client):
    client.get("/api/session")
    response = client.post("/api/session", {"email": "admin"}, content_type="application/json",
                           HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
    user = response.json()["user"]
    assert user["access"] == "superuser" and User.objects.get(email="admin").role == Role.SUPERUSER
    assert [d["key"] for d in user["departments"]] == list(Department.objects.order_by("pk").values_list("key", flat=True))


# ---- Department admins see their departments only ------------------------------------------------

def test_an_admin_sees_only_their_departments_cases(banking_admin, super_user, cases):
    queue = banking_admin.get("/api/assessments").json()
    assert [a["id"] for a in queue["results"]] == [cases["banking"].public_id]
    assert queue["total"] == 1 and set(queue["stageCounts"]) == {"REVIEW_PENDING"}
    assert banking_admin.get(f"/api/assessments/{cases['banking'].public_id}").status_code == 200
    # Another department's case does not exist as far as they can tell.
    for path in ("", "/case", "/form"):
        assert banking_admin.get(f"/api/assessments/{cases['insurance'].public_id}{path}").status_code == 404
    assert banking_admin.get("/api/assessments", department="insurance").json()["results"] == []
    # The super user sees both.
    assert {a["id"] for a in super_user.get("/api/assessments").json()["results"]} == {
        cases["banking"].public_id, cases["insurance"].public_id,
    }


def test_an_admin_opens_applications_only_for_their_departments(banking_admin):
    assert banking_admin.post("/api/assessments", NEW).status_code == 201
    refused = banking_admin.post("/api/assessments", {**NEW, "reference": "IS-1", "department": "insurance"})
    assert refused.status_code == 400 and "your own departments" in str(refused.json()["department"])


def test_an_admin_lists_and_configures_only_their_departments(banking_admin):
    assert [d["key"] for d in banking_admin.get("/api/departments").json()] == ["banking"]
    body = banking_admin.get("/api/questionnaire").json()
    assert body["department"] == {"key": "banking", "name": "Banking Licence"}
    assert banking_admin.get("/api/questionnaire", department="insurance").status_code == 403
    assert banking_admin.get("/api/questionnaire/impact", department="insurance").status_code == 403
    edit = {**structure(banking_admin), "department": "insurance"}
    assert banking_admin.put("/api/questionnaire", edit).status_code == 403
    assert banking_admin.get("/api/questionnaire", department="nowhere").status_code == 404


def test_an_admin_without_a_department_has_nothing_to_work_on(as_user):
    lonely = as_user(make.user("lonely@example.na", Role.REVIEWER))
    assert lonely.get("/api/assessments").json()["results"] == []
    assert lonely.get("/api/departments").json() == []
    assert lonely.get("/api/questionnaire").status_code == 403


def test_the_admin_panel_is_for_the_super_user_only(banking_admin, super_user):
    for path in ("/api/admin/overview", "/api/admin/users", "/api/admin/departments"):
        assert banking_admin.get(path).status_code == 403
        assert super_user.get(path).status_code == 200


# ---- Each department's questionnaire is its own ------------------------------------------------

def test_a_change_to_one_departments_questions_leaves_the_others(super_user, as_user):
    applicant = as_user(make.user("anna@example.na"))
    banking_case = applicant.post("/api/assessments", OWN).json()["id"]
    insurance_case = applicant.post("/api/assessments", {**OWN, "reference": "IS-9", "department": "insurance"}).json()["id"]
    insurance_before = super_user.get("/api/questionnaire", department="insurance").json()["current"]

    body = {**structure(super_user), "department": "banking"}
    body["sections"][-1]["questions"].append(new_question("Does the applicant hold a banking licence elsewhere?"))
    assert super_user.put("/api/questionnaire", body).status_code == 200

    def qids(case):
        return [a["qid"] for a in applicant.get(f"/api/assessments/{case}/form").json()["answers"]]

    assert "N1" in qids(banking_case) and "N1" not in qids(insurance_case)
    assert super_user.get("/api/questionnaire", department="insurance").json()["current"] == insurance_before
    banking = applicant.get("/api/catalogue", assessment=banking_case).json()
    insurance = applicant.get("/api/catalogue", assessment=insurance_case).json()
    assert "N1" in [q["qid"] for q in banking["questions"]] and "N1" not in [q["qid"] for q in insurance["questions"]]
    assert AuditEvent.objects.get(action="questionnaire.publish").metadata["department"] == "banking"


def test_a_publish_clears_only_its_own_departments_drafts(super_user, as_user):
    applicant = as_user(make.user("anna@example.na"))
    banking_case = applicant.post("/api/assessments", OWN).json()["id"]
    insurance_case = applicant.post("/api/assessments", {**OWN, "reference": "IS-9", "department": "insurance"}).json()["id"]
    for case in (banking_case, insurance_case):
        assert applicant.patch(f"/api/assessments/{case}/form", {"answers": {"A1": "Yes"}}).status_code == 200
    impact = super_user.get("/api/questionnaire/impact", department="banking").json()
    assert impact["drafts"] == 1 and impact["answered"] == {"A1": 1}

    # Banking deletes A1: its draft loses the answer; the insurance draft keeps it.
    body = {**structure(super_user), "department": "banking"}
    basic = body["sections"][0]
    basic["questions"][1]["weight"] += basic["questions"][0]["weight"]
    del basic["questions"][0]
    assert super_user.put("/api/questionnaire", body).status_code == 200

    def answer(case):
        return next((a["value"] for a in applicant.get(f"/api/assessments/{case}/form").json()["answers"] if a["qid"] == "A1"), None)

    assert answer(banking_case) is None and answer(insurance_case) == "Yes"


def test_the_catalogue_names_its_questions_and_takes_nothing_from_other_departments(super_user, banking_admin, as_user):
    applicant = as_user(make.user("anna@example.na"))
    # Each department has its own questions: which ones must be said.
    assert applicant.get("/api/catalogue").status_code == 400
    assert applicant.get("/api/catalogue", department="nowhere").status_code == 400
    # A reviewer reads only the departments they work on.
    assert banking_admin.get("/api/catalogue", department="insurance").status_code == 403
    assert banking_admin.get("/api/catalogue", department="banking").status_code == 200

    # A question added in banking, with its own document types: insurance has no such question,
    # so its catalogue offers nothing for that code.
    body = {**structure(super_user), "department": "banking"}
    body["sections"][-1]["questions"].append(new_question("Does the applicant hold a banking licence elsewhere?"))
    assert super_user.put("/api/questionnaire", body).status_code == 200
    assert "N1" in applicant.get("/api/catalogue", department="banking").json()["evidenceOptions"]
    assert "N1" not in applicant.get("/api/catalogue", department="insurance").json()["evidenceOptions"]


def test_an_assessment_is_held_to_its_departments_questions(super_user):
    insurance = Department.objects.get(key="insurance")
    super_user.put("/api/questionnaire", {**structure(super_user), "department": "banking"})  # nothing changed
    created = super_user.post("/api/assessments", {**NEW, "reference": "IS-9", "department": "insurance"}).json()
    from cases.models import Assessment

    assert Assessment.objects.get(public_id=created["id"]).version == catalogue.active_version(insurance)


# ---- The super user manages accounts ---------------------------------------------------------

def test_the_super_user_makes_a_user_an_admin_of_departments_and_back(super_user):
    ben = make.user("ben@example.na")
    browser = APIClient()
    browser.force_login(ben)
    url = f"/api/admin/users/{ben.pk}"

    refused = super_user.patch(url, {"role": "reviewer"})
    assert refused.status_code == 400 and "at least one department" in str(refused.json())
    assert super_user.patch(url, {"role": "reviewer", "departments": ["nowhere"]}).status_code == 400

    body = super_user.patch(url, {"role": "reviewer", "departments": ["insurance", "banking"]}).json()
    assert body["role"] == "reviewer" and [d["key"] for d in body["departments"]] == ["banking", "insurance"]
    assert browser.get("/api/session").json() == {"user": None}  # signed out for the new role
    events = {e.action: e.metadata for e in AuditEvent.objects.filter(target_id=str(ben.pk))}
    assert events["user.role_change"] == {"from": "applicant", "to": "reviewer"}
    assert events["user.departments_change"] == {"from": [], "to": ["banking", "insurance"]}

    # Departments change on their own; the account is not signed out for that.
    assert [d["key"] for d in super_user.patch(url, {"departments": ["markets"]}).json()["departments"]] == ["markets"]
    # Made a super user, they work on every department: none is kept on the account.
    body = super_user.patch(url, {"role": "superuser"}).json()
    assert body["role"] == "superuser" and body["departments"] == []
    body = super_user.patch(url, {"role": "applicant"}).json()
    assert body["role"] == "applicant"
    assert super_user.get("/api/admin/users", role="admin").json()["total"] == 0


def test_account_changes_that_are_refused(super_user, as_user):
    me = User.objects.get(email="admin")
    assert super_user.patch(f"/api/admin/users/{me.pk}", {"role": "applicant"}).status_code == 409
    assert super_user.patch(f"/api/admin/users/{me.pk}", {"isActive": False}).status_code == 409
    # An applicant with an application under way cannot be made an admin yet.
    anna = make.user("anna@example.na")
    make.assessment(applicant=anna)
    refused = super_user.patch(f"/api/admin/users/{anna.pk}", {"role": "reviewer", "departments": ["banking"]})
    assert refused.status_code == 409 and "FNP-2026-0001" in refused.json()["detail"]
    # The last super user who can sign in is never switched off or demoted.
    other = make.user("second@example.na", Role.SUPERUSER)
    other_client = as_user(other)
    User.objects.filter(email="admin").update(is_active=False)
    assert other_client.patch(f"/api/admin/users/{other.pk}", {"role": "reviewer"}).status_code == 409


def test_a_switched_off_account_is_signed_out(super_user):
    ben = make.user("ben@example.na")
    browser = APIClient()
    browser.force_login(ben)
    sessions = Session.objects.count()
    assert super_user.patch(f"/api/admin/users/{ben.pk}", {"isActive": False}).json()["isActive"] is False
    assert Session.objects.count() == sessions - 1
    assert browser.get("/api/session").json() == {"user": None}
    assert AuditEvent.objects.filter(action="user.deactivate", target_id=str(ben.pk)).exists()


# ---- The super user manages departments -----------------------------------------------------

def test_a_department_is_added_with_a_copy_of_another_departments_questions(super_user, as_user):
    body = {**structure(super_user), "department": "banking"}
    body["sections"][-1]["questions"].append(new_question("Does the applicant hold a banking licence elsewhere?"))
    assert super_user.put("/api/questionnaire", body).status_code == 200

    created = super_user.post("/api/admin/departments", {
        "key": "Pensions", "name": "Pension Funds", "blurb": "Retirement funds", "startFrom": "banking",
    })
    assert created.status_code == 201, created.json()
    row = created.json()
    assert row["key"] == "pensions" and row["isActive"] and row["assessmentCount"] == 0
    pensions = super_user.get("/api/questionnaire", department="pensions").json()["current"]
    banking = super_user.get("/api/questionnaire", department="banking").json()["current"]
    assert pensions["questions"] == banking["questions"] and pensions["version"] != banking["version"]
    # With no questions when none is named; a key or name taken is refused.
    assert super_user.post("/api/admin/departments", {"key": "funds", "name": "Funds"}).status_code == 201
    funds = super_user.get("/api/questionnaire", department="funds").json()
    assert funds["current"]["questions"] == [] and funds["published"]["questions"] == []
    assert super_user.post("/api/admin/departments", {"key": "pensions", "name": "Other"}).status_code == 400
    assert super_user.post("/api/admin/departments", {"key": "other", "name": "pension funds"}).status_code == 400
    assert AuditEvent.objects.filter(action="department.create", target_id="pensions").exists()

    applicant = as_user(make.user("anna@example.na"))
    assert "pensions" in [d["key"] for d in applicant.get("/api/departments").json()]
    assert applicant.post("/api/assessments", {**OWN, "reference": "PF-1", "department": "pensions"}).status_code == 201


def test_a_department_switched_off_takes_no_new_applications(super_user, as_user):
    applicant = as_user(make.user("anna@example.na"))
    existing = applicant.post("/api/assessments", {**OWN, "department": "markets"}).json()["id"]
    row = super_user.patch("/api/admin/departments/markets", {"isActive": False, "name": "Capital Markets (closed)"}).json()
    assert row["isActive"] is False and row["name"] == "Capital Markets (closed)"
    assert "markets" not in [d["key"] for d in applicant.get("/api/departments").json()]
    refused = applicant.post("/api/assessments", {**OWN, "reference": "CM-2", "department": "markets"})
    assert refused.status_code == 400
    # What was started carries on, and the reviewer side still lists the department.
    assert applicant.patch(f"/api/assessments/{existing}/form", {"answers": {"A1": "Yes"}}).status_code == 200
    markets = next(d for d in super_user.get("/api/departments").json() if d["key"] == "markets")
    assert markets["isActive"] is False
    assert super_user.patch("/api/admin/departments/markets", {"isActive": True}).json()["isActive"] is True
    assert super_user.patch("/api/admin/departments/markets", {"name": "Banking Licence"}).status_code == 400
    assert super_user.patch("/api/admin/departments/nowhere", {"name": "X"}).status_code == 404


# ---- Review round: refusals instead of guesses or server errors ----------------------------------

def test_a_save_must_name_its_department(super_user):
    versions = QuestionnaireVersion.objects.count()
    body = structure(super_user)
    del body["department"]
    refused = super_user.put("/api/questionnaire", body)
    assert refused.status_code == 400 and "department" in refused.json()
    assert super_user.put("/api/questionnaire", {**body, "department": 123}).status_code == 400
    assert QuestionnaireVersion.objects.count() == versions


def test_changing_an_admins_departments_signs_them_out(super_user):
    admin = make.admin("bank.admin@example.na", ("banking",))
    browser = APIClient()
    browser.force_login(admin)
    assert browser.get("/api/session").json()["user"]["email"] == admin.email
    super_user.patch(f"/api/admin/users/{admin.pk}", {"departments": ["insurance"]})
    assert browser.get("/api/session").json() == {"user": None}


def test_a_switched_off_department_says_so(super_user, as_user):
    super_user.patch("/api/admin/departments/payments", {"isActive": False})
    applicant = as_user(make.user("anna@example.na"))
    refused = applicant.post("/api/assessments", {**OWN, "department": "payments"})
    assert "not taking new applications" in str(refused.json()["department"])


def test_a_department_key_taken_at_the_same_moment_is_reported(super_user, monkeypatch):
    from cases.views.admin_panel import NewDepartmentSerializer

    # As if another super user added the same key between the check and the save.
    monkeypatch.setattr(NewDepartmentSerializer, "validate_key", lambda self, value: value.lower())
    refused = super_user.post("/api/admin/departments", {"key": "banking", "name": "Banking Two"})
    assert refused.status_code == 400 and "Another department has this key" in str(refused.json()["key"])


def test_starting_from_a_department_without_questions_is_refused(super_user):
    QuestionnaireVersion.objects.filter(department__key="markets").update(is_active=False)
    refused = super_user.post("/api/admin/departments", {"key": "funds", "name": "Funds", "startFrom": "markets"})
    assert refused.status_code == 400 and "startFrom" in refused.json()
    assert not Department.objects.filter(key="funds").exists()

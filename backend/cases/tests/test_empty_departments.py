"""Only banking keeps the questions every department once had: the others start with none, take no
applications until their admins set some up, and restore to their own starting point."""

import datetime

import pytest
from django.apps import apps
from django.db import connection

from cases import catalogue
from cases.models import Assessment, Department, QuestionnaireVersion, Stage
from cases.tests import factories as make
from cases.tests.test_questionnaire_edit import new_question

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]

OWN = {
    "applicantName": "Anna M. Nghipandulwa", "entity": "Kalahari Life Assurance", "position": "Director",
    "reference": "IS-2026-0001", "department": "insurance",
}


@pytest.fixture
def super_user(as_user):
    return as_user(make.reviewer())


@pytest.fixture
def applicant(as_user):
    return as_user(make.user("anna@example.na"))


def first_section(name="Licensing history") -> dict:
    return {"name": name, "weight": 100, "questions": [new_question("Has the applicant been refused a licence?", weight=100)]}


def test_only_banking_keeps_its_questions():
    published = QuestionnaireVersion.objects.filter(department__isnull=True).order_by("pk").first()
    for department in Department.objects.all():
        has = catalogue.has_questions(department)
        assert has == (department.key == "banking"), department.key
        if department.key == "banking":
            # Restoring banking goes back to the questions as first published, as before.
            assert department.starting_version == published
        else:
            assert department.starting_version == catalogue.active_version(department)
            assert not department.starting_version.questions.exists()


def test_a_department_with_an_application_in_progress_keeps_its_questions():
    from importlib import import_module

    migration = import_module("cases.migrations.0015_department_starting_points")
    make.questions_for("insurance", "markets")
    insurance = Department.objects.get(key="insurance")
    make.assessment(public_id="FNP-2026-0800", reference="IS-1", department=insurance, stage=Stage.REVIEW_PENDING)
    decided = Department.objects.get(key="markets")
    make.assessment(public_id="FNP-2026-0801", reference="CM-1", department=decided, stage=Stage.ACCEPTED)
    with connection.schema_editor() as editor:
        migration.empty_other_departments(apps, editor)
    assert catalogue.has_questions(insurance)  # in progress: kept
    assert not catalogue.has_questions(decided)  # only decided: emptied, the case keeps its edition
    assert Assessment.objects.get(public_id="FNP-2026-0801").version.questions.exists()


def test_a_department_with_no_questions_takes_no_applications(applicant, super_user):
    assert [d["key"] for d in applicant.get("/api/departments").json()] == ["banking"]
    refused = applicant.post("/api/assessments", OWN)
    assert refused.status_code == 400 and "no questions" in str(refused.json()["department"])
    by_reviewer = super_user.post("/api/assessments", {**OWN, "email": "ben@example.na", "initiatedOn": "2026-10-01"})
    assert by_reviewer.status_code == 400 and "no questions" in str(by_reviewer.json()["department"])
    # The reviewer side still lists it, saying it has none.
    insurance = next(d for d in super_user.get("/api/departments").json() if d["key"] == "insurance")
    assert insurance["hasQuestions"] is False


def test_continuing_into_a_department_with_no_questions_is_refused(applicant):
    insurance = Department.objects.get(key="insurance")
    owner = make.user("anna@example.na")
    source = Assessment.objects.create(
        public_id="FNP-2026-0802", applicant=owner, created_by=owner, applicant_name="Anna", department=insurance,
        entity="E", position="P", parent_reference="IS-OLD", initiated_on=datetime.date(2026, 1, 5),
        version=QuestionnaireVersion.objects.filter(department__isnull=True).first(), stage=Stage.ACCEPTED,
    )
    refused = applicant.post(f"/api/assessments/{source.public_id}/continue")
    assert refused.status_code == 409 and "no questions" in refused.json()["detail"]


def test_its_first_questions_open_it_for_applications(applicant, super_user):
    empty = super_user.get("/api/questionnaire", department="insurance").json()
    assert empty["current"]["questions"] == [] and empty["current"]["sections"] == []
    # Its starting point is empty: there is nothing to restore it to.
    assert empty["published"]["questions"] == []
    body = {"department": "insurance", "version": empty["current"]["version"], "sections": [first_section()]}
    published = super_user.put("/api/questionnaire", body)
    assert published.status_code == 200, published.json()
    assert [q["qid"] for q in published.json()["questions"]] == ["N1"]
    assert "insurance" in [d["key"] for d in applicant.get("/api/departments").json()]
    created = applicant.post("/api/assessments", OWN)
    assert created.status_code == 201
    form = applicant.get(f"/api/assessments/{created.json()['id']}/form").json()
    assert [a["qid"] for a in form["answers"]] == ["N1"]
    # Banking is untouched.
    assert len(super_user.get("/api/questionnaire", department="banking").json()["current"]["questions"]) == 15

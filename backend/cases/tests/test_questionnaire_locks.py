"""One admin at a time edits a department's questions; the others read them until they are done."""

import datetime

import pytest
from django.utils import timezone

from cases.models import AuditEvent, QuestionnaireLock, QuestionnaireVersion, User
from cases.tests import factories as make
from cases.tests.test_questionnaire_edit import structure

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]

A_TAB, A_OTHER_TAB, B_TAB, S_TAB = "anna-tab-1", "anna-tab-2", "ben-tab-1", "super-tab-1"


@pytest.fixture
def anna(as_user):
    return as_user(make.admin("anna@example.na", ("banking", "insurance")))


@pytest.fixture
def ben(as_user):
    return as_user(make.admin("ben@example.na", ("banking", "insurance")))


@pytest.fixture
def super_user(as_user):
    return as_user(make.reviewer())


def take(client, token, department="banking", **extra):
    return client.post("/api/questionnaire/lock", {"department": department, "token": token, **extra})


def edited(client, token=None):
    """The banking questionnaire with one weight shared differently, sent from this tab."""
    body = structure(client)
    basic = body["sections"][0]["questions"]
    basic[0]["weight"], basic[1]["weight"] = 2, 2
    return {**body, **({"lockToken": token} if token else {})}


def test_the_first_to_edit_holds_the_questions_and_the_other_reads_them(anna, ben):
    assert take(anna, A_TAB).json()["lock"]["email"] == "anna@example.na"
    # Ben opens the page: he sees who is editing.
    assert ben.get("/api/questionnaire", department="banking").json()["lock"]["email"] == "anna@example.na"
    refused = take(ben, B_TAB)
    assert refused.status_code == 409 and "anna@example.na is editing these questions" in refused.json()["detail"]
    assert ben.put("/api/questionnaire", edited(ben, B_TAB)).status_code == 409
    assert ben.put("/api/questionnaire", edited(ben)).status_code == 409  # nor from anywhere else
    # Anna applies: published, and the questions are free again.
    versions = QuestionnaireVersion.objects.count()
    assert anna.put("/api/questionnaire", edited(anna, A_TAB)).status_code == 200
    assert QuestionnaireVersion.objects.count() == versions + 1
    assert not QuestionnaireLock.objects.exists()
    assert take(ben, B_TAB).status_code == 200


def test_each_department_has_its_own_lock(anna, ben):
    assert take(anna, A_TAB, "banking").status_code == 200
    assert take(ben, B_TAB, "insurance").status_code == 200


def test_keeping_it_alive_and_giving_it_back(anna, ben):
    first = take(anna, A_TAB).json()["lock"]
    again = take(anna, A_TAB).json()["lock"]
    assert again["since"] == first["since"] and again["until"] >= first["until"]
    assert anna.delete(f"/api/questionnaire/lock?department=banking&token={A_TAB}").status_code == 204
    assert take(ben, B_TAB).status_code == 200
    # Giving back a lock someone else holds does nothing.
    anna.delete(f"/api/questionnaire/lock?department=banking&token={A_TAB}")
    assert QuestionnaireLock.objects.get().holder.email == "ben@example.na"


def test_a_lapsed_lock_can_be_taken(anna, ben):
    take(anna, A_TAB)
    QuestionnaireLock.objects.update(seen_at=timezone.now() - datetime.timedelta(minutes=16))
    assert ben.get("/api/questionnaire", department="banking").json()["lock"] is None
    assert take(ben, B_TAB).status_code == 200
    # Anna comes back and applies: refused, as Ben is editing now.
    assert anna.put("/api/questionnaire", edited(anna, A_TAB)).status_code == 409


def test_a_second_tab_of_the_same_admin(anna):
    take(anna, A_TAB)
    refused = take(anna, A_OTHER_TAB)
    assert refused.status_code == 409 and "another tab" in refused.json()["detail"]
    assert take(anna, A_OTHER_TAB, takeOver=True).status_code == 200  # "Edit here instead"
    refused = anna.put("/api/questionnaire", edited(anna, A_TAB))
    assert refused.status_code == 409 and "another tab" in refused.json()["detail"]


def test_only_the_super_user_takes_over_from_another_admin(anna, ben, super_user):
    take(anna, A_TAB)
    assert take(ben, B_TAB, takeOver=True).status_code == 409
    assert take(super_user, S_TAB, takeOver=True).json()["lock"]["email"] == "admin"
    assert AuditEvent.objects.get(action="questionnaire.take_over").metadata == {"from": "anna@example.na"}
    refused = anna.put("/api/questionnaire", edited(anna, A_TAB))
    assert refused.status_code == 409 and "took over editing" in refused.json()["detail"]


def test_losing_the_department_gives_the_lock_back(anna, super_user):
    take(anna, A_TAB)
    anna_id = User.objects.get(email="anna@example.na").pk
    super_user.patch(f"/api/admin/users/{anna_id}", {"departments": ["insurance"]})
    assert not QuestionnaireLock.objects.exists()


def test_an_admin_of_another_department_cannot_take_it(as_user):
    other = as_user(make.admin("ins@example.na", ("insurance",)))
    assert take(other, "ins-tab-1").status_code == 403


def test_lock_refusals_carry_a_code_and_a_tab_knows_its_own_lock(anna, ben):
    take(anna, A_TAB)
    assert take(ben, B_TAB).json()["code"] == "lock_held"
    assert ben.put("/api/questionnaire", edited(ben, B_TAB)).json()["code"] == "lock_held"
    take(anna, A_OTHER_TAB, takeOver=True)
    other_tab = anna.put("/api/questionnaire", edited(anna, A_TAB)).json()
    assert other_tab["code"] == "lock_held" and "another tab" in other_tab["detail"]
    # Read with its token, the holding tab sees the lock as its own; another tab does not.
    mine = anna.get("/api/questionnaire", department="banking", token=A_OTHER_TAB).json()["lock"]
    assert mine["thisTab"] is True
    assert anna.get("/api/questionnaire", department="banking", token=A_TAB).json()["lock"]["thisTab"] is False


def test_two_departments_cannot_end_up_with_the_same_name(super_user, monkeypatch):
    from cases.views.admin_panel import NewDepartmentSerializer

    monkeypatch.setattr(NewDepartmentSerializer, "validate_name", lambda self, value: value)
    refused = super_user.post("/api/admin/departments", {"key": "banking-two", "name": "banking licence"})
    assert refused.status_code == 400 and "Another department has this name" in str(refused.json()["name"])


def test_a_lock_is_checked_against_the_account_as_it_is_now():
    from rest_framework.exceptions import PermissionDenied

    from cases import question_locks
    from cases.models import Department

    banking = Department.objects.get(key="banking")
    anna_account = make.admin("anna@example.na", ("banking",))
    anna_account.department_ids()  # as the request read them, a moment before
    anna_account.departments.clear()  # banking taken away meanwhile
    with pytest.raises(PermissionDenied):
        question_locks.take(banking, anna_account, A_TAB)
    assert not QuestionnaireLock.objects.exists()


def test_a_lock_held_by_someone_who_lost_the_department_does_not_count(anna, ben):
    take(anna, A_TAB)
    User.objects.get(email="anna@example.na").departments.set([])
    assert ben.get("/api/questionnaire", department="banking").json()["lock"] is None
    assert take(ben, B_TAB).status_code == 200

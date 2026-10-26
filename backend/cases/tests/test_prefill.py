"""The five known applicants find "Start a new application" filled in with their details on record;
everyone else starts from an empty form, as before."""

import pytest
from rest_framework.test import APIClient

from cases import prefill
from cases.models import Assessment
from cases.tests import factories as make

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]

KNOWN = {
    "j.amutenya@example.na": ("Johanna N. Amutenya", "Oshakati Microfinance Bank Limited", "Non-Executive Director", "BL-2026-0412"),
    "p.shivute@example.na": ("Petrus K. Shivute", "Erongo Building Society", "Executive Director", "BL-2026-0455"),
    "e.haufiku@example.na": ("Elias T. Haufiku", "Namib Trust Bank Limited", "Non-Executive Director", "BL-2026-0233"),
    "m.vanwyk@example.na": ("Maria L. van Wyk", "Oshakati Microfinance Bank Limited", "Executive Director", "BL-2026-0398"),
    "m.kaapanda@example.na": ("Margaret Kaapanda", "Kavango Financial Services", "Non-Executive Director", "BL-2026-0289"),
}


def test_each_of_the_five_gets_their_own_details(as_user):
    for email, (name, entity, position, reference) in KNOWN.items():
        body = as_user(make.user(email)).get("/api/assessments/prefill").json()
        assert body == {"prefill": {
            "applicantName": name, "department": "banking", "entity": entity, "position": position,
            "reference": reference,
        }}, email


def test_the_email_is_matched_whatever_its_case():
    assert prefill.details_for("  J.Amutenya@Example.NA ")["applicantName"] == "Johanna N. Amutenya"


def test_anyone_else_gets_nothing(as_user):
    assert as_user(make.user("someone.else@example.na")).get("/api/assessments/prefill").json() == {"prefill": None}


def test_reviewers_and_strangers_are_refused(as_user):
    assert as_user(make.reviewer()).get("/api/assessments/prefill").status_code == 403
    assert APIClient().get("/api/assessments/prefill").status_code == 401


def test_a_reference_already_used_moves_on_to_the_next_free_number(as_user):
    johanna = make.user("j.amutenya@example.na")
    client = as_user(johanna)
    # Their demo case already holds the reference (as after seed_demo).
    make.assessment(applicant=johanna, public_id="FNP-2026-0412", reference="BL-2026-0412")
    assert client.get("/api/assessments/prefill").json()["prefill"]["reference"] == "BL-2026-0412-2"
    make.assessment(applicant=johanna, public_id="FNP-2026-0413", reference="BL-2026-0412-2")
    assert client.get("/api/assessments/prefill").json()["prefill"]["reference"] == "BL-2026-0412-3"


def test_the_details_start_an_application_as_any_typed_in_would(as_user):
    client = as_user(make.user("p.shivute@example.na"))
    details = client.get("/api/assessments/prefill").json()["prefill"]
    created = client.post("/api/assessments", details)
    assert created.status_code == 201, created.json()
    made = Assessment.objects.get(public_id=created.json()["id"])
    assert (made.applicant_name, made.entity, made.parent_reference) == (
        "Petrus K. Shivute", "Erongo Building Society", "BL-2026-0455",
    )
    # Asked again, the reference has moved on.
    assert client.get("/api/assessments/prefill").json()["prefill"]["reference"] == "BL-2026-0455-2"


def test_a_prefill_never_shows_another_applicants_details(as_user):
    # Looked up by the signed-in email only: a query parameter naming someone else changes nothing.
    client = as_user(make.user("someone.else@example.na"))
    assert client.get("/api/assessments/prefill", email="j.amutenya@example.na").json() == {"prefill": None}


def test_a_department_not_taking_applications_is_left_to_choose(as_user):
    """Switched off, or without questions yet: the form would refuse it, so it is not filled in."""
    from cases.models import Department

    johanna = as_user(make.user("j.amutenya@example.na"))
    Department.objects.filter(key="banking").update(is_active=False)
    assert johanna.get("/api/assessments/prefill").json()["prefill"]["department"] == ""
    Department.objects.filter(key="banking").update(is_active=True)
    assert johanna.get("/api/assessments/prefill").json()["prefill"]["department"] == "banking"

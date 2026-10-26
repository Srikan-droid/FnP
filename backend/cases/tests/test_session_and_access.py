import datetime

import pytest
from django.conf import settings
from django.http import Http404
from django.utils import timezone
from rest_framework.test import APIClient

from cases.models import AuditEvent, Role
from cases.permissions import assessment_for
from cases.tests import factories as make

pytestmark = pytest.mark.django_db


@pytest.fixture
def client() -> APIClient:
    # CSRF is enforced exactly as in production, which Django's test client skips by default.
    return APIClient(enforce_csrf_checks=True)


def _csrf(client: APIClient) -> str:
    client.get("/api/session")
    return client.cookies["csrftoken"].value


def _sign_in(client: APIClient, email: str):
    return client.post("/api/session", {"email": email}, format="json", HTTP_X_CSRFTOKEN=_csrf(client))


def test_reading_the_session_signed_out_sets_the_csrf_cookie(client):
    response = client.get("/api/session")
    assert response.status_code == 200
    assert response.json() == {"user": None}
    assert "csrftoken" in response.cookies


def test_sign_in_requires_the_csrf_token(client):
    client.get("/api/session")
    response = client.post("/api/session", {"email": "a@example.na"}, format="json")
    assert response.status_code == 403


def test_a_session_lasts_from_its_last_use_not_from_sign_in(client):
    from django.contrib.sessions.models import Session

    _sign_in(client, "a@example.na")
    session = Session.objects.get()
    Session.objects.filter(pk=session.pk).update(expire_date=session.expire_date - datetime.timedelta(hours=7))
    assert client.get("/api/session").json()["user"]["email"] == "a@example.na"
    # The request renewed it to a full 8 hours from now.
    assert Session.objects.get().expire_date > timezone.now() + datetime.timedelta(hours=7, minutes=55)


def test_a_session_in_use_is_not_rewritten_on_every_request(client):
    from django.contrib.sessions.models import Session

    _sign_in(client, "a@example.na")
    expires = Session.objects.get().expire_date
    # Polling straight after signing in: the session is read, not written again.
    for _ in range(3):
        response = client.get("/api/session")
        assert response.json()["user"]["email"] == "a@example.na"
        assert settings.SESSION_COOKIE_NAME not in response.cookies
    assert Session.objects.get().expire_date == expires


def test_an_email_signs_in_as_an_applicant_and_admin_as_the_reviewer(client):
    response = _sign_in(client, " A.Person@Example.NA ")
    assert response.json() == {"user": {"email": "a.person@example.na", "role": "applicant", "access": "user"}}
    reviewer = _sign_in(APIClient(enforce_csrf_checks=True), "Admin")
    user = reviewer.json()["user"]
    # "admin" is the super user: the reviewer side, every department.
    assert {k: user[k] for k in ("email", "role", "access")} == {"email": "admin", "role": "reviewer", "access": "superuser"}
    assert [d["key"] for d in user["departments"]][:2] == ["banking", "education"]


def test_sign_in_rejects_anything_that_is_not_an_email(client):
    assert _sign_in(client, "not an email").status_code == 400


def test_sign_in_rotates_the_session_key(client):
    client.get("/api/session")
    before = client.cookies.get("sessionid")
    _sign_in(client, "a@example.na")
    after = client.cookies["sessionid"].value
    assert after and (before is None or before.value != after)


def test_session_cookie_is_http_only(client):
    _sign_in(client, "a@example.na")
    assert client.cookies["sessionid"]["httponly"]


def test_sign_out_needs_csrf_and_ends_the_session(client):
    _sign_in(client, "a@example.na")
    assert client.delete("/api/session").status_code == 403
    assert client.delete("/api/session", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value).status_code == 204
    assert client.get("/api/session").json() == {"user": None}


def test_sign_in_and_out_are_audited(client):
    _sign_in(client, "a@example.na")
    client.delete("/api/session", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
    assert list(AuditEvent.objects.values_list("action", flat=True).order_by("id")) == [
        "session.sign_in",
        "session.sign_out",
    ]


def test_an_applicant_only_reaches_their_own_assessment_and_the_reviewer_any():
    owner = make.user("owner@example.na")
    other = make.user("other@example.na")
    reviewer = make.reviewer()
    assessment = make.assessment(applicant=owner)
    assert assessment_for(owner, assessment.public_id) == assessment
    assert assessment_for(reviewer, assessment.public_id) == assessment
    with pytest.raises(Http404):
        assessment_for(other, assessment.public_id)


def test_unknown_routes_and_methods_do_not_leak_details(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert b"Traceback" not in response.content


def test_the_development_sign_in_is_off_unless_enabled(client, settings):
    settings.DEV_SIGN_IN = False
    response = _sign_in(client, "admin")
    assert response.status_code == 403 and "not available" in response.json()["detail"]
    assert client.get("/api/session").json() == {"user": None}

"""The API call log: every /api/ call with the JSON sent and returned, secrets masked, uploads as
their names and sizes only."""

import logging

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from cases.tests.test_phase2_api import applicant, opened, reviewer  # noqa: F401  (fixtures)

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]


@pytest.fixture
def logged(settings, caplog, monkeypatch):
    """The log on, written only to the test's capture (never to the real console or log file)."""
    settings.API_LOG = True
    caplog.set_level(logging.INFO, logger="cases.api")
    monkeypatch.setattr(logging.getLogger("cases.api"), "handlers", [caplog.handler])
    return caplog


def test_a_json_call_is_logged_with_what_was_sent_and_returned(applicant, opened, logged):
    applicant.patch(f"/api/assessments/{opened}/form", {"answers": {"A1": "Yes"}})
    (entry,) = [r.getMessage() for r in logged.records if f"/api/assessments/{opened}/form" in r.getMessage()]
    assert entry.startswith(f"PATCH /api/assessments/{opened}/form → 200")
    assert '"A1": "Yes"' in entry and '"answers"' in entry and "response:" in entry


def test_an_upload_is_logged_by_name_and_size_never_its_contents(applicant, opened, logged):
    pdf = SimpleUploadedFile("scan.pdf", b"%PDF-1.7\n%secret contents\n", content_type="application/pdf")
    applicant.post(f"/api/assessments/{opened}/documents", {"file": pdf}, multipart=True)
    entry = next(r.getMessage() for r in logged.records if "/documents" in r.getMessage())
    assert "<file 'scan.pdf', application/pdf" in entry and "secret contents" not in entry


def test_secrets_are_masked_and_the_log_is_off_by_default(applicant, opened, logged, settings):
    from cases.middleware import _shown

    assert '"password": "***"' in _shown({"user": "a", "password": "hunter2"})
    settings.API_LOG = False
    logged.clear()
    applicant.get(f"/api/assessments/{opened}/form")
    assert not [r for r in logged.records if r.name == "cases.api"]


def test_the_editing_lock_token_is_masked_in_the_body_and_the_address(reviewer, logged):
    reviewer.delete("/api/questionnaire/lock?department=banking&token=tab-secret-123")
    entry = next(r.getMessage() for r in logged.records if "/api/questionnaire/lock" in r.getMessage())
    assert "tab-secret-123" not in entry and "token=***" in entry and "department=banking" in entry
    from cases.middleware import _shown

    assert '"lockToken": "***"' in _shown({"department": "banking", "lockToken": "tab-secret-123"})

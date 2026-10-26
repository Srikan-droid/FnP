"""The database itself refuses bad data. Each test goes around Django's validation (raw SQL or
.update()) to prove the constraint lives in PostgreSQL, not only in Python."""

import pytest
from django.db import IntegrityError, connection, transaction

from cases.models import AnswerValue, ApplicantProfile, Department, QuestionnaireVersion, Submission
from cases.tests import factories as make

pytestmark = pytest.mark.django_db


def _violates(fn) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        fn()


def test_emails_are_stored_lower_case_and_unique():
    make.user("Someone@Example.NA")
    assert make.user("someone@example.na").email == "someone@example.na"
    with connection.cursor() as cur:
        _violates(lambda: cur.execute(
            "INSERT INTO \"user\" (email, role, is_active, created_at, password) "
            "VALUES ('Upper@Example.na', 'applicant', true, now(), '!')"
        ))


def test_only_one_questionnaire_version_is_active_per_department():
    # Migration 0014 gave every department its own copy of the questionnaire, in force.
    banking = Department.objects.get(key="banking")
    _violates(lambda: QuestionnaireVersion.objects.create(label="x-1", is_active=True, department=banking))
    # An edition in force always belongs to a department.
    _violates(lambda: QuestionnaireVersion.objects.create(label="x-2", is_active=True))
    QuestionnaireVersion.objects.create(label="x-3", is_active=False, department=banking)


def test_parent_reference_is_unique_regardless_of_case():
    make.assessment(public_id="FNP-2026-0001", reference="BL-2026-0510")
    _violates(lambda: make.assessment(public_id="FNP-2026-0002", reference="bl-2026-0510"))


def test_stage_and_enum_columns_only_take_declared_values():
    assessment = make.assessment()
    _violates(lambda: type(assessment).objects.filter(pk=assessment.pk).update(stage="SOMETHING_ELSE"))


def test_one_answer_per_question():
    assessment = make.assessment()
    AnswerValue.objects.create(assessment=assessment, qid="A1", value="Yes")
    _violates(lambda: AnswerValue.objects.create(assessment=assessment, qid="A1", value="No"))
    # Which values are allowed depends on the question (Yes/No/N/A, or words for a text question), so
    # that is checked in code: see test_a_choice_question_refuses_anything_else.


def test_submission_attempts_are_unique_and_outcomes_valid():
    assessment = make.assessment()
    Submission.objects.create(assessment=assessment, attempt_no=1, version=assessment.version, payload={})
    _violates(lambda: Submission.objects.create(
        assessment=assessment, attempt_no=1, version=assessment.version, payload={}
    ))
    _violates(lambda: Submission.objects.filter(assessment=assessment).update(outcome="UNKNOWN"))


def test_national_id_number_is_encrypted_at_rest():
    assessment = make.assessment()
    ApplicantProfile.objects.create(assessment=assessment, national_id_number="74061800117")
    with connection.cursor() as cur:
        cur.execute("SELECT national_id_number FROM applicant_profile WHERE assessment_id = %s", [assessment.pk])
        stored = cur.fetchone()[0]
    assert "74061800117" not in stored
    assert ApplicantProfile.objects.get(pk=assessment.pk).national_id_number == "74061800117"


def test_values_stay_readable_while_the_encryption_key_is_rotated(settings):
    from cryptography.fernet import Fernet

    from cases import fields

    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    settings.FIELD_ENCRYPTION_KEY = old
    fields._fernet.cache_clear()
    assessment = make.assessment()
    ApplicantProfile.objects.create(assessment=assessment, national_id_number="74061800117")
    # The new key goes first; the old one stays listed so existing values can still be read.
    settings.FIELD_ENCRYPTION_KEY = f"{new},{old}"
    fields._fernet.cache_clear()
    try:
        assert ApplicantProfile.objects.get(pk=assessment.pk).national_id_number == "74061800117"
    finally:
        fields._fernet.cache_clear()


def test_assessment_serial_sequence_hands_out_each_value_once():
    with connection.cursor() as cur:
        cur.execute("SELECT nextval('assessment_serial'), nextval('assessment_serial')")
        first, second = cur.fetchone()
    assert second == first + 1 and first >= 1000

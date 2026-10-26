"""Minimal builders for tests: just enough rows to satisfy the schema's constraints. The reference
data (departments, questionnaire v1) comes from migration 0003, as in every real database."""

import datetime

from cases.models import Assessment, Department, QuestionnaireVersion, Role, User


def user(email: str = "a.applicant@example.na", role: str = Role.APPLICANT) -> User:
    return User.objects.get_or_create_for_email(email, role)


def reviewer() -> User:
    """The built-in "admin" sign-in: the super user, who works on every department."""
    return user("admin", Role.SUPERUSER)


def label(department: str = "banking") -> str:
    """The name of the department's questionnaire edition in force."""
    return QuestionnaireVersion.objects.get(is_active=True, department__key=department).label


def version_in_force(department: str = "banking") -> QuestionnaireVersion:
    return QuestionnaireVersion.objects.get(is_active=True, department__key=department)


def versions_at_start() -> int:
    """The editions every test database starts with: the published model, each department's copy
    of it (0014), and an empty one for every department but banking (0015)."""
    return 2 * Department.objects.count()


def questions_for(*keys: str) -> None:
    """Gives these departments (every one but banking if none is named) a copy of banking's
    questions in force, as every department had before only banking kept them."""
    from cases.views.catalogue import copy_version

    banking = QuestionnaireVersion.objects.get(is_active=True, department__key="banking")
    departments = Department.objects.filter(key__in=keys) if keys else Department.objects.exclude(key="banking")
    for department in departments:
        QuestionnaireVersion.objects.filter(is_active=True, department=department).update(is_active=False)
        copy_version(banking, department)


def admin(email: str = "d.admin@example.na", departments: tuple[str, ...] = ("banking",)) -> User:
    """A reviewer (an admin) of these departments only."""
    account = user(email, Role.REVIEWER)
    account.departments.set(Department.objects.filter(key__in=departments))
    return account


def assessment(
    applicant: User | None = None,
    public_id: str = "FNP-2026-0001",
    reference: str = "BL-2026-0001",
    created_by: User | None = None,
    **fields,
) -> Assessment:
    department = fields.pop("department", None) or Department.objects.get(key="banking")
    return Assessment.objects.create(
        public_id=public_id,
        applicant=applicant or user(),
        applicant_name="Anna M. Nghipandulwa",
        department=department,
        entity="Namib Trust Bank Limited",
        position="Non-Executive Director",
        parent_reference=reference,
        initiated_on=datetime.date(2026, 10, 1),
        version=QuestionnaireVersion.objects.get(is_active=True, department=department),
        created_by=created_by,
        **fields,
    )

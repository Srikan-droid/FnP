from django.db.models import QuerySet
from django.http import Http404
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from .models import Assessment, Department, User


class IsReviewer(BasePermission):
    """The reviewer side of the app: an admin (for their departments) or the super user."""

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_reviewer)


class IsSuperUser(BasePermission):
    """Managing accounts and departments, and the admin panel: the super user only."""

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_super_user)


def visible_assessments(user: User, queryset: QuerySet | None = None) -> QuerySet:
    """The assessments this user may see: every one for the super user, those of their departments
    for an admin, their own for an applicant."""
    qs = queryset if queryset is not None else Assessment.objects.all()
    departments = user.department_ids()
    if departments is None:
        return qs
    if user.is_reviewer:
        return qs.filter(department_id__in=departments)
    return qs.filter(applicant=user)


def assessment_for(user: User, public_id: str, *, queryset=None) -> Assessment:
    """The assessment if this user may see it, otherwise 404 — never 403, so nobody can learn which
    assessment ids exist outside what they may see. Every view that takes an assessment id goes
    through here."""
    try:
        return visible_assessments(user, queryset).get(public_id=public_id)
    except Assessment.DoesNotExist:
        raise Http404 from None


def may_manage(user: User, department: Department) -> bool:
    """Whether this user works on this department's cases and questions."""
    departments = user.department_ids()
    return user.is_reviewer and (departments is None or department.pk in departments)


def managed_departments(user: User) -> QuerySet:
    """The departments this user works on (every one for the super user), in their usual order."""
    departments = user.department_ids()
    qs = Department.objects.order_by("pk")
    return qs if departments is None else qs.filter(pk__in=departments)


def department_to_manage(user: User, key: str | None) -> Department:
    """The department named by key, if this user works on it; with no key, the first they work on.
    Refused (403) for another department, 404 for one that does not exist."""
    if key:
        department = Department.objects.filter(key=key).first()
        if department is None:
            raise Http404
        if not may_manage(user, department):
            raise PermissionDenied("You do not work on this department.")
        return department
    department = managed_departments(user).first()
    if department is None:
        raise PermissionDenied("You have no department to work on yet. Ask the super user to give you one.")
    return department

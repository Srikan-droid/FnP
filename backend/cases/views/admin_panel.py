"""The super user's admin panel: counts across the whole system, who uses it and with what access,
and the departments.

Only identifiers, roles, dates and counts leave here: no applicant details (date of birth, ID
number, phone) and no documents. Each read runs a fixed number of queries however many users or
assessments there are. Every change to an account or a department is recorded in the audit trail."""

import datetime

from django.db import IntegrityError, transaction
from django.db.models import Count, OuterRef, Prefetch, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import audit, catalogue
from ..accounts import held_cases, lock_access_changes, other_super_users, promotion_refused, release_lost_work
from ..auth_sessions import end_sessions
from ..models import (
    STAFF_ROLES, Assessment, AuditEvent, Department, EvidenceFile, Question, QuestionnaireVersion, Role, RunStatus,
    Stage, Submission, User, Verdict,
)
from ..permissions import IsSuperUser
from .assessments import NEEDS_REVIEWER
from .catalogue import copy_version, empty_version
from .common import Conflict
from .session import REVIEWER_USERNAME

PAGE_SIZE = 50
RECENT_DAYS = 7
RECENT_ACTIVITY = 20


def _since() -> datetime.datetime:
    return timezone.now() - datetime.timedelta(days=RECENT_DAYS)


# The filters the user list offers: "reviewer" is everyone on the reviewer side (admins and the
# super user), as before there were two kinds; "admin" and "superuser" each kind on its own.
ROLE_FILTERS = {
    Role.APPLICANT.value: [Role.APPLICANT],
    Role.REVIEWER.value: list(STAFF_ROLES),
    "admin": [Role.REVIEWER],
    Role.SUPERUSER.value: [Role.SUPERUSER],
}


def _departments(user: User) -> list[dict]:
    """An admin's departments (read from the prefetch where there is one)."""
    if user.role != Role.REVIEWER:
        return []
    return [{"key": d.key, "name": d.name} for d in sorted(user.departments.all(), key=lambda d: d.pk)]


def _user_row(user: User) -> dict:
    return {
        "id": user.pk,
        "email": user.email,
        "role": user.role,
        "departments": _departments(user),
        "isActive": user.is_active,
        "isStaff": user.is_staff,
        # Accounts whose role and status are not changed here: the built-in "admin" sign-in (the
        # super user nobody can lock out) and the admin site's staff accounts.
        "accessFixed": user.email == REVIEWER_USERNAME or user.is_staff,
        "joinedAt": user.created_at,
        "lastLoginAt": user.last_login,
    }


class AdminOverviewView(APIView):
    """GET: the system at a glance: users, assessments by stage and department, engine runs and
    stored documents."""

    permission_classes = [IsSuperUser]

    def get(self, request):
        since = _since()
        users = User.objects.aggregate(
            total=Count("pk"),
            applicants=Count("pk", filter=Q(role=Role.APPLICANT)),
            reviewers=Count("pk", filter=Q(role__in=STAFF_ROLES)),
            admins=Count("pk", filter=Q(role=Role.REVIEWER)),
            super_users=Count("pk", filter=Q(role=Role.SUPERUSER)),
            active=Count("pk", filter=Q(is_active=True)),
            inactive=Count("pk", filter=Q(is_active=False)),
            new_recently=Count("pk", filter=Q(created_at__gte=since)),
            signed_in_recently=Count("pk", filter=Q(last_login__gte=since)),
        )
        assessments = Assessment.objects.aggregate(
            total=Count("pk"),
            awaiting_reviewer=Count("pk", filter=Q(stage__in=NEEDS_REVIEWER)),
            submitted_recently=Count("pk", filter=Q(submitted_at__gte=since)),
            accepted=Count("pk", filter=Q(decision__verdict=Verdict.ACCEPTED)),
            rejected=Count("pk", filter=Q(decision__verdict=Verdict.REJECTED)),
        )
        by_stage = dict.fromkeys(Stage.values, 0)
        for row in Assessment.objects.values("stage").annotate(n=Count("pk")).order_by():
            by_stage[row["stage"]] = row["n"]
        by_department = [
            {"key": d.key, "name": d.name, "count": d.n}
            for d in Department.objects.annotate(n=Count("assessments")).order_by("name")
        ]
        runs = Submission.objects.aggregate(
            in_progress=Count("pk", filter=Q(status__in=[RunStatus.QUEUED, RunStatus.RUNNING])),
            failed=Count("pk", filter=Q(status=RunStatus.FAILED)),
        )
        documents = EvidenceFile.objects.filter(superseded_at__isnull=True).aggregate(
            count=Count("pk"), bytes=Sum("size_bytes")
        )
        return Response({
            "generatedAt": timezone.now(),
            "recentDays": RECENT_DAYS,
            "users": {
                "total": users["total"],
                "applicants": users["applicants"],
                "reviewers": users["reviewers"],
                "admins": users["admins"],
                "superUsers": users["super_users"],
                "active": users["active"],
                "inactive": users["inactive"],
                "newRecently": users["new_recently"],
                "signedInRecently": users["signed_in_recently"],
            },
            "assessments": {
                "total": assessments["total"],
                "awaitingReviewer": assessments["awaiting_reviewer"],
                "submittedRecently": assessments["submitted_recently"],
                "accepted": assessments["accepted"],
                "rejected": assessments["rejected"],
                "byStage": by_stage,
                "byDepartment": by_department,
            },
            "runs": {"inProgress": runs["in_progress"], "failed": runs["failed"]},
            "documents": {"count": documents["count"], "bytes": documents["bytes"] or 0},
        })


class AdminUserListView(APIView):
    """GET: every account, newest first, a page at a time. Narrowed by ?search= (part of an email),
    ?role= (applicant | reviewer | admin | superuser) and ?status= (active | inactive); ?page= from 1."""

    permission_classes = [IsSuperUser]

    def get(self, request):
        params = request.query_params
        qs = User.objects.all()
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(email__icontains=search)
        role = params.get("role", "")
        if role:
            if role not in ROLE_FILTERS:
                raise ValidationError({"role": "Unknown role."})
            qs = qs.filter(role__in=ROLE_FILTERS[role])
        status = params.get("status", "")
        if status:
            if status not in ("active", "inactive"):
                raise ValidationError({"status": "Choose active or inactive."})
            qs = qs.filter(is_active=status == "active")
        try:
            page = int(params.get("page", "1"))
            if page < 1:
                raise ValueError
        except ValueError:
            raise ValidationError({"page": "Invalid page."}) from None

        total = qs.count()
        latest = Assessment.objects.filter(applicant=OuterRef("pk")).order_by("-updated_at").values("stage")[:1]
        rows = list(
            qs.annotate(assessment_count=Count("assessments"), latest_stage=Subquery(latest))
            .prefetch_related(Prefetch("departments", queryset=Department.objects.only("pk", "key", "name")))
            .order_by("-created_at", "-id")[(page - 1) * PAGE_SIZE : page * PAGE_SIZE + 1]
        )
        more = len(rows) > PAGE_SIZE
        return Response({
            "results": [
                {**_user_row(u), "assessmentCount": u.assessment_count, "latestStage": u.latest_stage}
                for u in rows[:PAGE_SIZE]
            ],
            "next": str(page + 1) if more else None,
            "total": total,
        })


class AccessSerializer(serializers.Serializer):
    """A change to an account's access; anything left out stays as it is."""

    role = serializers.ChoiceField(choices=Role.values, required=False)
    departments = serializers.ListField(child=serializers.SlugField(max_length=32), required=False, max_length=100)
    isActive = serializers.BooleanField(required=False)


class AdminUserDetailView(APIView):
    """GET: one account, the assessments it applies under, and what it did most recently. PATCH:
    the super user changes its role (user, admin or super user), an admin's departments, or
    whether it may sign in."""

    permission_classes = [IsSuperUser]

    def patch(self, request, user_id):
        data = AccessSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        with transaction.atomic():
            # Changes to accounts' access are made one at a time: the last-super-user check
            # below locks every super user, and two such changes taking their targets first
            # would wait on each other.
            lock_access_changes()
            user = get_object_or_404(User.objects.select_for_update(), pk=user_id)
            role = v.get("role", user.role)
            active = v.get("isActive", user.is_active)
            before_keys = sorted(user.departments.values_list("key", flat=True))
            keys = sorted(set(v["departments"])) if "departments" in v else before_keys
            changing = role != user.role or active != user.is_active
            if changing and user.pk == request.user.pk:
                raise Conflict("You cannot change your own role or switch off your own account.")
            if changing and (user.email == REVIEWER_USERNAME or user.is_staff):
                raise Conflict("The built-in admin sign-in and staff accounts keep their role and stay on.")
            if role in STAFF_ROLES and user.role not in STAFF_ROLES:
                refused = promotion_refused(user)
                if refused:
                    raise Conflict(refused)
            leaving = user.role == Role.SUPERUSER and (role != Role.SUPERUSER or not active)
            if leaving and not other_super_users(user):
                raise Conflict("There must always be a super user who can sign in.")
            # Only an admin works on chosen departments: the super user works on every one, and an
            # applicant on none.
            if role != Role.REVIEWER:
                keys = []
            departments = list(Department.objects.filter(key__in=keys))
            if len(departments) != len(keys):
                raise ValidationError({"departments": "Choose departments from the list."})
            if role == Role.REVIEWER and not departments:
                raise ValidationError({"departments": "Give an admin at least one department."})

            if role != user.role:
                audit.record(request.user, "user.role_change", target_type="user", target_id=user.pk,
                             metadata={"from": user.role, "to": role})
            if keys != before_keys:
                audit.record(request.user, "user.departments_change", target_type="user", target_id=user.pk,
                             metadata={"from": before_keys, "to": keys})
            if active != user.is_active:
                audit.record(request.user, "user.activate" if active else "user.deactivate",
                             target_type="user", target_id=user.pk)
            # A new role or new departments: their next sign-in shows the app as they now are.
            signed_out = role != user.role or not active or keys != before_keys
            user.role, user.is_active = role, active
            user.save(update_fields=["role", "is_active"])
            user.departments.set(departments)
            # Cases they can no longer act on go back to the queue for the other admins.
            released = release_lost_work(user, request.user)
            if signed_out:
                # Their next sign-in opens the app for the new role (or not at all, switched off).
                end_sessions([user])
        response = self.get(request, user_id)
        response.data["released"] = released
        return response

    def get(self, request, user_id):
        user = get_object_or_404(User, pk=user_id)
        # The latest engine run of each, in the same query: the request ID the engine gave it.
        latest_run = Submission.objects.filter(assessment=OuterRef("pk")).order_by("-attempt_no")
        assessments = (
            Assessment.objects.filter(applicant=user)
            .select_related("department")
            .annotate(
                run_count=Count("submissions"),
                request_id=Subquery(latest_run.values("engine_request_id")[:1]),
                run_status=Subquery(latest_run.values("status")[:1]),
            )
            .order_by("-updated_at")
        )
        activity = AuditEvent.objects.filter(actor=user).order_by("-occurred_at")[:RECENT_ACTIVITY]
        return Response({
            **_user_row(user),
            # The cases they are reviewing now: going back to the queue if their access is taken.
            "reviewing": held_cases(user).count(),
            "assessments": [
                {
                    "id": a.public_id,
                    "applicantName": a.applicant_name,
                    "department": {"key": a.department.key, "name": a.department.name},
                    "position": a.position,
                    "stage": a.stage,
                    "updatedAt": a.updated_at,
                    "submittedAt": a.submitted_at,
                    "decidedAt": a.decided_at,
                    "requestId": a.request_id,
                    "runCount": a.run_count,
                    "runStatus": a.run_status,
                }
                for a in assessments
            ],
            "activity": [
                {"at": e.occurred_at, "action": e.action, "assessmentRef": e.assessment_ref} for e in activity
            ],
        })


# ---- Departments ---------------------------------------------------------------------------


def _department_rows(departments) -> list[dict]:
    in_force = catalogue.active_versions(d.pk for d in departments)
    counts = dict(
        Question.objects.filter(version__in=in_force.values()).values_list("version_id").annotate(n=Count("pk")).order_by()
    )
    return [
        {
            "key": d.key,
            "name": d.name,
            "blurb": d.blurb,
            "isActive": d.is_active,
            "assessmentCount": d.assessment_count,
            "adminCount": d.admin_count,
            "questionCount": counts.get(in_force[d.pk].pk, 0) if d.pk in in_force else 0,
            # Submitted cases not decided that no admin has taken yet.
            "waitingCount": d.waiting_count,
            "version": in_force[d.pk].label if d.pk in in_force else None,
        }
        for d in departments
    ]


def _count(qs, field: str):
    """Counts the rows of qs for each department (`field` names it), as a subquery: no joins
    multiplied together, however many cases and admins a department has."""
    counted = qs.filter(**{field: OuterRef("pk")}).order_by().values(field).annotate(n=Count("pk")).values("n")
    return Coalesce(Subquery(counted), 0)


def _counted(qs):
    from ..workflow import REVIEWABLE

    # Admins who can sign in: a switched-off one keeps their departments but takes no cases.
    admins = User.departments.through.objects.filter(user__role=Role.REVIEWER, user__is_active=True)
    return qs.annotate(
        waiting_count=_count(Assessment.objects.filter(stage__in=REVIEWABLE, reviewer__isnull=True), "department"),
        assessment_count=_count(Assessment.objects.all(), "department"),
        admin_count=_count(admins, "department"),
    )


NAME_TAKEN = "Another department has this name."
KEY_TAKEN = "Another department has this key."


def _name_taken(name: str, department: Department | None = None) -> bool:
    """Whether another department has this name (in any case): the database refuses it too, so a
    name taken at the same moment is caught on saving (_taken_refusal)."""
    others = Department.objects.filter(name__iexact=name)
    return (others.exclude(pk=department.pk) if department else others).exists()


def _taken_refusal(key: str | None = None) -> ValidationError:
    """What the database refused as already taken (by a request at the same moment): the key, if
    that is what clashed, otherwise the name."""
    if key is not None and Department.objects.filter(key=key).exists():
        return ValidationError({"key": [KEY_TAKEN]})
    return ValidationError({"name": [NAME_TAKEN]})


class NewDepartmentSerializer(serializers.Serializer):
    key = serializers.SlugField(max_length=32)
    name = serializers.CharField(max_length=120, trim_whitespace=True)
    blurb = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=True, default="")
    # The department whose questionnaire in force it starts with a copy of; left out, no questions.
    startFrom = serializers.SlugField(max_length=32, required=False, allow_null=True)

    def validate_key(self, value):
        value = value.lower()
        if Department.objects.filter(key=value).exists():
            raise serializers.ValidationError(KEY_TAKEN)
        return value

    def validate_name(self, value):
        if _name_taken(value):
            raise serializers.ValidationError(NAME_TAKEN)
        return value


class DepartmentChangeSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, trim_whitespace=True, required=False)
    blurb = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=True, required=False)
    isActive = serializers.BooleanField(required=False)


class AdminDepartmentListView(APIView):
    """GET: every department with what it holds. POST: the super user adds a department, with no
    questions (or a copy of another department's); its admins and the super user then configure its
    questions, and it takes applications once it has some."""

    permission_classes = [IsSuperUser]

    def get(self, request):
        return Response(_department_rows(list(_counted(Department.objects.order_by("pk")))))

    def post(self, request):
        data = NewDepartmentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        source_key = v.get("startFrom")
        with transaction.atomic():
            if source_key:
                source_department = Department.objects.filter(key=source_key).first()
                try:
                    source = catalogue.active_version(source_department) if source_department else None
                except QuestionnaireVersion.DoesNotExist:
                    source = None
                if source is None:
                    raise ValidationError({"startFrom": "Choose a department from the list."})
            else:
                source = None
            try:
                with transaction.atomic():
                    department = Department.objects.create(key=v["key"], name=v["name"], blurb=v["blurb"])
            except IntegrityError:
                # Added by someone else a moment ago (the database keeps keys and names unique).
                raise _taken_refusal(v["key"]) from None
            version = copy_version(source, department) if source is not None else empty_version(department)
            # What "Restore published model" goes back to for it.
            department.starting_version = version
            department.save(update_fields=["starting_version"])
            audit.record(request.user, "department.create", target_type="department", target_id=department.key,
                         metadata={"startFrom": source_key or "no questions", "version": version.label})
        row = _department_rows([_counted(Department.objects.filter(pk=department.pk)).get()])[0]
        return Response(row, status=status.HTTP_201_CREATED)


class AdminDepartmentDetailView(APIView):
    """PATCH: the super user renames a department, or switches it off (it then takes no new
    applications; its cases carry on) and on again. A department is never deleted: cases are filed
    under it."""

    permission_classes = [IsSuperUser]

    def patch(self, request, key):
        data = DepartmentChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        with transaction.atomic():
            department = get_object_or_404(Department.objects.select_for_update(), key=key)
            if "name" in v and _name_taken(v["name"], department):
                raise ValidationError({"name": [NAME_TAKEN]})
            changes = {}
            for field, attr in (("name", "name"), ("blurb", "blurb"), ("isActive", "is_active")):
                if field in v and getattr(department, attr) != v[field]:
                    changes[field] = {"from": getattr(department, attr), "to": v[field]}
                    setattr(department, attr, v[field])
            if changes:
                try:
                    with transaction.atomic():
                        department.save(update_fields=["name", "blurb", "is_active"])
                except IntegrityError:
                    # Renamed to the same name by someone else a moment ago.
                    raise _taken_refusal() from None
                audit.record(request.user, "department.update", target_type="department", target_id=department.key,
                             metadata=changes)
        return Response(_department_rows([_counted(Department.objects.filter(pk=department.pk)).get()])[0])

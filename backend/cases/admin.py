"""The admin site at /admin/, for staff accounts (manage.py createsuperuser).

Staff may look at everything, but case records stay as the workflow made them: assessments,
answers, documents, runs, rulings, scores, decisions and the audit trail are read-only, so a case
can never be put into a state the workflow would not produce, and the trail cannot be edited. The
only changes possible are a user's active status and role (both recorded in the audit trail) and the
departments' names. National ID numbers are never shown, and documents are listed without a link to
the file.
"""

import json

from django import forms
from django.contrib import admin, messages
from django.contrib.auth.models import Group
from django.db import transaction
from django.utils.html import format_html

from . import audit
from .accounts import lock_access_changes, other_super_users, promotion_refused, release_lost_work
from .auth_sessions import end_sessions
from .models import (
    AnswerValue,
    ApplicantProfile,
    Assessment,
    AuditEvent,
    Decision,
    Department,
    CaseDocument,
    EvidenceFile,
    Question,
    QuestionnaireVersion,
    QuestionResult,
    QuestionSection,
    STAFF_ROLES,
    Role,
    Stage,
    Ruling,
    Score,
    Submission,
    SubmissionDocument,
    User,
)
from .views.session import REVIEWER_USERNAME

# Accounts have a role, not groups or per-user permissions: Django's own Groups page would only
# offer records that mean nothing here.
admin.site.unregister(Group)

admin.site.site_header = "Fit and Proper Assessment: Administration"
admin.site.site_title = "Fit and Proper Assessment admin"
admin.site.index_title = "Records"


def pretty_json(value) -> str:
    """A JSON document, indented, for reading on a record's page."""
    if value in (None, "", {}, []):
        return "—"
    return format_html("<pre style='white-space:pre-wrap;margin:0'>{}</pre>", json.dumps(value, indent=2, ensure_ascii=False))


class ReadOnlyAdmin(admin.ModelAdmin):
    """Viewable, never added to, changed or deleted here."""

    def get_readonly_fields(self, request, obj=None):
        # Every field shown, as plain values (timestamps and the like cannot be form fields).
        shown = self.fields or [f.name for f in self.model._meta.fields if f.name not in (self.exclude or ())]
        return list(dict.fromkeys([*shown, *self.readonly_fields]))

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = False

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---- People and reference data -----------------------------------------------------------------

class UserAdminForm(forms.ModelForm):
    class Meta:
        model = User
        fields = "__all__"
        help_texts = {
            "role": (
                "Reviewer gives access to every case, rulings, decisions and question settings. "
                "The app's development sign-in has no password, so anyone who knows a reviewer's "
                "email can sign in as them: give reviewer access only on a server where sign-in is "
                "limited to people you trust, until real authentication replaces it."
            ),
        }

    def clean_role(self):
        # Changes to accounts' access are made one after another (the admin site saves inside a
        # transaction, so this holds until the change is saved).
        lock_access_changes()
        role = self.cleaned_data["role"]
        if role in STAFF_ROLES and self.instance.pk and self.instance.role not in STAFF_ROLES:
            refused = promotion_refused(self.instance)
            if refused:
                raise forms.ValidationError(refused)
        if self.instance.pk and self.instance.role == Role.SUPERUSER and role != Role.SUPERUSER:
            if not other_super_users(self.instance):
                raise forms.ValidationError("There must always be a super user who can sign in.")
        return role

    def clean(self):
        cleaned = super().clean()
        role = cleaned.get("role", self.instance.role)
        # An admin works on the departments chosen here (the admin site's own staff accounts never
        # use the app, so they need none).
        if "departments" in cleaned and role == Role.REVIEWER and not self.instance.is_staff and not cleaned["departments"]:
            self.add_error("departments", "Give an admin at least one department.")
        if "is_active" in cleaned and not cleaned["is_active"] and self.instance.pk and self.instance.role == Role.SUPERUSER:
            if self.instance.is_active and not other_super_users(self.instance):
                self.add_error("is_active", "There must always be a super user who can sign in.")
        return cleaned


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    form = UserAdminForm
    list_display = ("email", "role", "is_active", "is_staff", "created_at", "last_login")
    list_filter = ("role", "is_active", "is_staff")
    search_fields = ("email",)
    ordering = ("-created_at",)
    fields = ("email", "role", "departments", "is_active", "is_staff", "created_at", "last_login")
    # An admin (role reviewer) works on the departments chosen here; the super user on every one.
    filter_horizontal = ("departments",)
    # Admin access is given on the account's own page (or in the app's admin panel), where its
    # departments are chosen with it: a bulk action could only make admins with none.
    actions = ("make_applicant",)

    def get_readonly_fields(self, request, obj=None):
        # Whether the account may sign in, and its role, can change here. A staff member cannot
        # lock themselves out, and some accounts keep their role (see role_fixed).
        fixed = ["email", "is_staff", "created_at", "last_login"]
        if obj is not None and obj.pk == request.user.pk:
            fixed.append("is_active")
        if obj is not None and role_fixed(request, obj):
            fixed.append("role")
        return fixed

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        # Only an admin keeps departments: a user applies, and the super user works on every one.
        if form.instance.role != Role.REVIEWER:
            form.instance.departments.clear()
        # Cases they can no longer act on go back to the queue for the other admins.
        release_lost_work(form.instance, request.user)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if "is_active" in form.changed_data:
            action = "user.activate" if obj.is_active else "user.deactivate"
            audit.record(request.user, action, target_type="user", target_id=obj.pk)
        if "role" in form.changed_data:
            role_changed(request, obj, form.initial.get("role"))
        if "role" in form.changed_data or "departments" in form.changed_data:
            # Their next sign-in opens the app for the role and departments they now have.
            end_sessions([obj])

    @admin.action(description="Make the selected users applicants (remove admin access)")
    def make_applicant(self, request, queryset):
        self._set_role(request, queryset, Role.APPLICANT)

    def _set_role(self, request, queryset, role):
        # One transaction for the whole action: the last-super-user check locks rows, and access
        # changes are made one after another.
        with transaction.atomic():
            lock_access_changes()
            self._set_roles(request, queryset, role)

    def _set_roles(self, request, queryset, role):
        changed, skipped, blocked, moved = 0, [], 0, []
        for user in queryset:
            if user.role == role:
                continue
            if role_fixed(request, user):
                skipped.append(user.email)
                continue
            refused = promotion_refused(user) if role in STAFF_ROLES and user.role not in STAFF_ROLES else None
            if user.role == Role.SUPERUSER and role != Role.SUPERUSER and not other_super_users(user):
                refused = f"{user.email} is the last super user who can sign in."
            if refused:
                self.message_user(request, f"Not changed: {refused}", messages.WARNING)
                blocked += 1
                continue
            before = user.role
            user.role = role
            user.save(update_fields=["role"])
            if role != Role.REVIEWER:
                user.departments.clear()
            release_lost_work(user, request.user)
            role_changed(request, user, before)
            moved.append(user)
            changed += 1
        # Everyone changed is signed out, in one pass over the sessions.
        end_sessions(moved)
        label = Role(role).label.lower()
        if changed:
            self.message_user(request, f"{changed} user(s) are now {label}s.", messages.SUCCESS)
        if skipped:
            self.message_user(
                request,
                f"Not changed (your own account, a staff account or the built-in admin): {', '.join(skipped)}.",
                messages.WARNING,
            )
        if not changed and not skipped and not blocked:
            self.message_user(request, f"The selected users are already {label}s.", messages.INFO)


def role_fixed(request, user: User) -> bool:
    """Accounts whose role cannot change: your own (no locking yourself out), staff accounts (the
    admin site's own, always reviewers) and the built-in reviewer sign-in "admin", without which
    nobody could sign in to the app as a reviewer."""
    return user.pk == request.user.pk or user.is_staff or user.email == REVIEWER_USERNAME


def role_changed(request, user: User, before) -> None:
    """Records the change. The caller then signs the user out everywhere (end_sessions), so their
    next sign-in opens the app for their new role instead of a session made for the old one."""
    audit.record(request.user, "user.role_change", target_type="user", target_id=user.pk,
                 metadata={"from": before, "to": user.role})


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ("key", "name", "blurb", "is_active")
    readonly_fields = ("key",)  # Assessments and the frontend refer to departments by key.

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---- Questionnaire -------------------------------------------------------------------------------

class QuestionSectionInline(ReadOnlyInline):
    model = QuestionSection
    fields = ("position", "name", "weight")


@admin.register(QuestionnaireVersion)
class QuestionnaireVersionAdmin(ReadOnlyAdmin):
    list_display = ("label", "department", "published_at", "is_active")
    list_filter = ("department", "is_active")
    inlines = [QuestionSectionInline]


@admin.register(Question)
class QuestionAdmin(ReadOnlyAdmin):
    list_display = ("qid", "version", "section", "evidence_required", "allowed_answers", "file_types", "max_files")
    list_filter = ("version",)
    list_select_related = ("version", "section")
    search_fields = ("qid", "text")


# ---- Cases ---------------------------------------------------------------------------------------

class AnswerInline(ReadOnlyInline):
    model = AnswerValue
    fields = ("qid", "value", "updated_at")


class EvidenceInline(ReadOnlyInline):
    model = EvidenceFile
    # The stored file itself is not linked: it is served only through the app, to people allowed it.
    fields = ("qid", "doc_type", "role", "original_name", "size_bytes", "uploaded_at", "superseded_at")


class SubmissionInline(ReadOnlyInline):
    model = Submission
    fields = ("attempt_no", "status", "outcome", "submitted_at", "completed_at")
    show_change_link = True


@admin.register(Assessment)
class AssessmentAdmin(ReadOnlyAdmin):
    list_display = ("public_id", "applicant_name", "applicant", "department", "stage", "initiated_on", "submitted_at", "decided_at")
    list_filter = ("stage", "department")
    list_select_related = ("applicant", "department")
    search_fields = ("public_id", "applicant_name", "parent_reference", "applicant__email")
    ordering = ("-updated_at",)
    inlines = [AnswerInline, EvidenceInline, SubmissionInline]


@admin.register(ApplicantProfile)
class ApplicantProfileAdmin(ReadOnlyAdmin):
    # The national ID number is left out on purpose: it is encrypted at rest and never displayed here.
    fields = ("assessment", "date_of_birth", "nationality", "town", "phone", "updated_at")
    list_display = ("assessment", "nationality", "town", "updated_at")
    list_select_related = ("assessment",)
    search_fields = ("assessment__public_id",)


@admin.register(EvidenceFile)
class EvidenceFileAdmin(ReadOnlyAdmin):
    fields = (
        "public_id", "assessment", "qid", "option_code", "doc_type", "role", "description", "original_name",
        "content_type", "size_bytes", "sha256", "uploaded_by", "uploaded_at", "superseded_at",
    )
    list_display = ("original_name", "assessment", "qid", "doc_type", "role", "size_bytes", "uploaded_at", "superseded_at")
    list_filter = ("doc_type", "role")
    list_select_related = ("assessment",)
    search_fields = ("assessment__public_id", "original_name", "qid")


@admin.register(CaseDocument)
class CaseDocumentAdmin(ReadOnlyAdmin):
    """An applicant's uploaded documents ("Your documents"), before or after attaching them."""

    fields = (
        "public_id", "assessment", "original_name", "content_type", "size_bytes", "sha256", "uploaded_by", "uploaded_at",
    )
    list_display = ("original_name", "assessment", "size_bytes", "uploaded_at")
    list_select_related = ("assessment",)
    search_fields = ("assessment__public_id", "original_name")


class QuestionResultInline(ReadOnlyInline):
    model = QuestionResult
    fields = ("qid", "status", "verdict", "confidence")


class RulingInline(ReadOnlyInline):
    model = Ruling
    fields = ("qid", "verdict", "comment", "reviewer", "created_at")


@admin.register(Submission)
class SubmissionAdmin(ReadOnlyAdmin):
    list_display = ("assessment", "attempt_no", "status", "outcome", "submitted_at", "completed_at")
    list_filter = ("status", "outcome")
    list_select_related = ("assessment",)
    search_fields = ("assessment__public_id", "engine_request_id")
    exclude = ("payload",)
    readonly_fields = ("payload_document",)
    inlines = [QuestionResultInline, RulingInline]

    @admin.display(description="Sent to the engine")
    def payload_document(self, obj):
        return pretty_json(obj.payload)


@admin.register(SubmissionDocument)
class SubmissionDocumentAdmin(ReadOnlyAdmin):
    list_display = ("submission",)
    list_select_related = ("submission__assessment",)
    search_fields = ("submission__assessment__public_id",)
    fields = ("submission", "authentication_document", "score_document", "assessment_document")
    readonly_fields = fields

    @admin.display(description="Authentication report")
    def authentication_document(self, obj):
        return pretty_json(obj.authentication)

    @admin.display(description="Score")
    def score_document(self, obj):
        return pretty_json(obj.score)

    @admin.display(description="Written assessment")
    def assessment_document(self, obj):
        return pretty_json(obj.assessment)


@admin.register(Score)
class ScoreAdmin(ReadOnlyAdmin):
    list_display = ("submission", "source", "risk_score", "band", "knock_out", "recommendation", "created_at")
    list_filter = ("band", "source", "knock_out")
    list_select_related = ("submission__assessment",)
    exclude = ("lines",)
    readonly_fields = ("lines_document",)

    @admin.display(description="Lines")
    def lines_document(self, obj):
        return pretty_json(obj.lines)


@admin.register(Decision)
class DecisionAdmin(ReadOnlyAdmin):
    list_display = ("assessment", "verdict", "reviewer", "decided_at")
    list_filter = ("verdict",)
    list_select_related = ("assessment", "reviewer")
    search_fields = ("assessment__public_id",)


# ---- Audit trail ---------------------------------------------------------------------------------

@admin.register(AuditEvent)
class AuditEventAdmin(ReadOnlyAdmin):
    list_display = ("occurred_at", "actor", "action", "assessment_ref", "target_type", "target_id")
    list_filter = ("action",)
    list_select_related = ("actor",)
    search_fields = ("assessment_ref", "actor__email", "action")
    date_hierarchy = "occurred_at"
    ordering = ("-occurred_at",)
    exclude = ("metadata",)
    readonly_fields = ("metadata_document",)

    @admin.display(description="Details")
    def metadata_document(self, obj):
        return pretty_json(obj.metadata)

"""The application's data. Correctness is enforced by the database itself: foreign keys, unique and
check constraints, so bad data cannot get in even if application code is wrong. Large engine
documents and uploaded files are kept out of the frequently-read tables."""

import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import BrinIndex
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower, Upper
from django.utils import timezone

from .fields import EncryptedTextField


def _in_choices(field: str, choices: type[models.TextChoices], name: str) -> models.CheckConstraint:
    """Holds an enum-like column to its declared values at the database level."""
    return models.CheckConstraint(condition=Q(**{f"{field}__in": choices.values}), name=name)


# ---------------------------------------------------------------------------------------------
# Enumerations (module level so model Meta constraints and other modules can reference them)
# ---------------------------------------------------------------------------------------------


class Role(models.TextChoices):
    """Who an account is. An applicant (a "user") applies; a reviewer (an "admin") reviews and
    decides the cases of the departments they are given; the super user sees and manages
    everything, accounts and departments included."""

    APPLICANT = "applicant"
    REVIEWER = "reviewer"
    SUPERUSER = "superuser", "Super user"


# The roles that work on the reviewer side of the app.
STAFF_ROLES = (Role.REVIEWER, Role.SUPERUSER)


class Answer(models.TextChoices):
    YES = "Yes"
    NO = "No"
    NA = "N/A"


class Polarity(models.TextChoices):
    POSITIVE = "Positive"
    NEGATIVE = "Negative"


class EvidenceRule(models.TextChoices):
    ALWAYS = "always"
    IF_YES = "if_yes"
    # No document is asked for, whatever the answer (a text question that needs none, say).
    NEVER = "never"


class AnswerType(models.TextChoices):
    """How a question is answered: one of its allowed answers (Yes, No, N/A), or in words."""

    CHOICE = "choice"
    TEXT = "text"


# The longest answer in words accepted for a text question.
TEXT_ANSWER_MAX = 2000


class EvidenceRole(models.TextChoices):
    PRIMARY = "primary"
    SUPPORTING = "supporting"


class Stage(models.TextChoices):
    """Where an assessment stands. Only cases.workflow changes it."""

    NOT_SUBMITTED = "NOT_SUBMITTED"
    AUTH_RUNNING = "AUTH_RUNNING"
    AUTH_FAILED = "AUTH_FAILED"
    REVIEW_PENDING = "REVIEW_PENDING"
    AWAITING_APPLICANT = "AWAITING_APPLICANT"
    SCORING = "SCORING"
    DECISION_PENDING = "DECISION_PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class RunStatus(models.TextChoices):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Outcome(models.TextChoices):
    CLEAR = "CLEAR"
    RETURN_TO_FILER = "RETURN_TO_FILER"


class ResultStatus(models.TextChoices):
    AUTHENTICATED = "authenticated"
    ISSUE = "issue"
    NOT_CHECKED = "not_checked"


class Verdict(models.TextChoices):
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ScoreSource(models.TextChoices):
    ENGINE = "engine"
    BACKEND_OVERRIDE = "backend_override"


class Band(models.TextChoices):
    LOW = "Low"
    MODERATE = "Moderate"
    ELEVATED = "Elevated"
    HIGH = "High"


# ---------------------------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------------------------


class UserManager(BaseUserManager):
    def get_by_natural_key(self, email):
        return self.get(email=email.strip().lower())

    def get_or_create_for_email(self, email: str, role: str) -> "User":
        user, created = self.get_or_create(email=email.strip().lower(), defaults={"role": role})
        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
        return user

    def create_superuser(self, email: str, password: str | None = None, **extra) -> "User":
        """A staff account for the admin site (manage.py createsuperuser): a reviewer with a
        password. The app's own sign-in refuses it as an applicant, so it cannot be used to see
        another person's applications."""
        user = self.model(email=email.strip().lower(), role=Role.REVIEWER, is_staff=True, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    # Stored lower-cased (enforced by a check constraint), so the plain unique index is
    # case-insensitive in effect and lookups can use it directly.
    email = models.CharField(max_length=254)
    role = models.CharField(max_length=16, choices=Role.choices)
    is_active = models.BooleanField(default=True)
    # May sign in to the admin site at /admin/ (with a password). No effect on the app itself.
    is_staff = models.BooleanField(default=False)
    # For a reviewer (an admin): the departments whose cases and questions they work on. The super
    # user works on every department, whatever is set here.
    departments = models.ManyToManyField("Department", blank=True, related_name="admins", db_table="user_department")
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []
    objects = UserManager()

    # The admin site asks these. Every active staff account may see every model; what may be
    # changed is decided per model in cases/admin.py, which keeps case records read-only.
    def has_perm(self, perm: str, obj=None) -> bool:
        return self.is_active and self.is_staff

    def has_module_perms(self, app_label: str) -> bool:
        return self.is_active and self.is_staff

    class Meta:
        db_table = "user"
        constraints = [
            models.UniqueConstraint(fields=["email"], name="user_email_unique"),
            models.CheckConstraint(condition=Q(email=Lower("email")), name="user_email_lowercase"),
            _in_choices("role", Role, "user_role_valid"),
        ]

    @property
    def is_reviewer(self) -> bool:
        """Works on the reviewer side: an admin or the super user."""
        return self.role in STAFF_ROLES

    @property
    def is_super_user(self) -> bool:
        return self.role == Role.SUPERUSER

    def department_ids(self) -> set[int] | None:
        """The departments this account may see the cases and questions of: None for every one
        (the super user), none for an applicant. Read once per request and kept on the user."""
        if self.is_super_user:
            return None
        if not self.is_reviewer:
            return set()
        if not hasattr(self, "_department_ids"):
            if "departments" in getattr(self, "_prefetched_objects_cache", {}):
                self._department_ids = {d.pk for d in self.departments.all()}  # loaded already
            else:
                self._department_ids = set(self.departments.values_list("pk", flat=True))
        return self._department_ids


# ---------------------------------------------------------------------------------------------
# Reference data: departments and the versioned question catalogue
# ---------------------------------------------------------------------------------------------


class Department(models.Model):
    key = models.SlugField(max_length=32, db_index=False)
    name = models.CharField(max_length=120)
    blurb = models.CharField(max_length=200, blank=True)
    # A department switched off takes no new applications; its cases stay as they are.
    is_active = models.BooleanField(default=True)
    # The questionnaire edition the department started from: what "Restore published model" goes
    # back to. An empty one for a department that started with no questions.
    starting_version = models.ForeignKey(
        "QuestionnaireVersion", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        db_table = "department"
        constraints = [
            models.UniqueConstraint(fields=["key"], name="department_key_unique"),
            # Two departments named alike would be indistinguishable in every picker.
            models.UniqueConstraint(Lower("name"), name="department_name_ci_unique"),
        ]

    def __str__(self) -> str:
        return self.name


class QuestionnaireVersion(models.Model):
    """One immutable edition of the question set. Any change to the questions creates a new
    version; each submission records the version it was made against."""

    label = models.CharField(max_length=40)
    published_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=False)
    # Each department has its own questionnaire. Null for the editions from before departments had
    # their own (the first one is still the model "Restore published model" goes back to).
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.PROTECT, related_name="questionnaire_versions"
    )

    class Meta:
        db_table = "questionnaire_version"
        constraints = [
            models.UniqueConstraint(fields=["label"], name="questionnaire_label_unique"),
            # One edition in force per department; an edition in force always has its department.
            models.UniqueConstraint(
                fields=["department"], condition=Q(is_active=True), name="questionnaire_one_active_per_department"
            ),
            models.CheckConstraint(
                condition=Q(is_active=False) | Q(department__isnull=False), name="questionnaire_active_has_department"
            ),
        ]

    def __str__(self) -> str:
        return self.label


class QuestionSection(models.Model):
    version = models.ForeignKey(
        QuestionnaireVersion, on_delete=models.PROTECT, related_name="sections", db_index=False
    )  # indexed by the composite index or unique rule that starts with it
    name = models.CharField(max_length=120)
    weight = models.DecimalField(max_digits=5, decimal_places=2)
    position = models.PositiveSmallIntegerField()

    class Meta:
        db_table = "question_section"
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["version", "name"], name="section_unique_name")]

    def __str__(self) -> str:
        return self.name


class Question(models.Model):
    version = models.ForeignKey(
        QuestionnaireVersion, on_delete=models.PROTECT, related_name="questions", db_index=False
    )  # indexed by the composite index or unique rule that starts with it
    section = models.ForeignKey(QuestionSection, on_delete=models.PROTECT, related_name="questions")
    qid = models.CharField(max_length=10)
    text = models.TextField()
    polarity = models.CharField(max_length=8, choices=Polarity.choices)
    weight = models.DecimalField(max_digits=5, decimal_places=2)
    is_knockout = models.BooleanField(default=False)
    evidence_required = models.CharField(max_length=8, choices=EvidenceRule.choices)
    answer_type = models.CharField(max_length=8, choices=AnswerType.choices, default=AnswerType.CHOICE)
    # For a question the engine has no document types of its own for (one added here), the codes of
    # the engine's document types the reviewer chose for it. Empty: the engine's own list applies.
    evidence_options = ArrayField(models.CharField(max_length=60), default=list, blank=True)
    # Added in this app's question configuration (not one the engine's questionnaire has): the
    # reviewer names its document types, since the engine has no list of its own for it.
    added_here = models.BooleanField(default=False)
    allows_na = models.BooleanField(default=False)
    accepts_supporting = models.BooleanField(default=False)
    checks = ArrayField(models.CharField(max_length=60), default=list)
    allowed_answers = ArrayField(models.CharField(max_length=3, choices=Answer.choices), default=list)
    file_types = ArrayField(models.CharField(max_length=8), default=list)
    max_files = models.PositiveSmallIntegerField(default=1)
    position = models.PositiveSmallIntegerField()

    class Meta:
        db_table = "question"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["version", "qid"], name="question_unique_qid"),
            _in_choices("polarity", Polarity, "question_polarity_valid"),
            _in_choices("evidence_required", EvidenceRule, "question_evidence_rule_valid"),
            _in_choices("answer_type", AnswerType, "question_answer_type_valid"),
            models.CheckConstraint(condition=Q(max_files__in=[1, 2]), name="question_max_files_valid"),
            models.CheckConstraint(condition=Q(weight__gte=0), name="question_weight_non_negative"),
        ]

    def __str__(self) -> str:
        return self.qid


# ---------------------------------------------------------------------------------------------
# Assessments and what the applicant fills in
# ---------------------------------------------------------------------------------------------


class Assessment(models.Model):
    public_id = models.CharField(max_length=20)
    applicant = models.ForeignKey(User, on_delete=models.PROTECT, related_name="assessments", db_index=False)  # indexed by the composite index or unique rule that starts with it
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="assessments", db_index=False)  # indexed by the composite index or unique rule that starts with it
    # The applicant as named on the parent application; the form shows it read-only.
    applicant_name = models.CharField(max_length=200)
    entity = models.CharField(max_length=200)
    position = models.CharField(max_length=200)
    parent_reference = models.CharField(max_length=40)
    initiated_on = models.DateField()
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.NOT_SUBMITTED)
    version = models.ForeignKey(QuestionnaireVersion, on_delete=models.PROTECT, related_name="+")
    # Null for the built-in demo assessments loaded by the seed command.
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.PROTECT, related_name="created_assessments"
    )
    # The decided application this one was continued from ("Continue with previous"), if any: its
    # reference is numbered on from the first application of the line.
    continued_from = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="continuations"
    )
    # The admin reviewing it: the first of the department's admins to take it (or the one the super
    # user gave it to). Only they rule on it, send it on and decide it; the others can read it.
    # Null while nobody has taken it. Kept once decided, as a record of who reviewed it.
    reviewer = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.PROTECT, related_name="reviewing", db_index=False
    )  # indexed by the composite index that starts with it
    claimed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # When the stage last changed, for how long a case has waited where it is ("Waiting 3 days"):
    # updated_at moves with every action on the case. Set by workflow.set_stage, which every stage
    # change goes through.
    stage_changed_at = models.DateTimeField(default=timezone.now)
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "assessment"
        constraints = [
            models.UniqueConstraint(fields=["public_id"], name="assessment_public_id_unique"),
            models.UniqueConstraint(Upper("parent_reference"), name="assessment_reference_ci_unique"),
            _in_choices("stage", Stage, "assessment_stage_valid"),
        ]
        indexes = [
            models.Index(fields=["applicant", "-updated_at"], name="assessment_by_applicant"),
            # The reviewer queue: filter by stage, newest first, keyset-paginated on (updated_at, id).
            models.Index(fields=["stage", "-updated_at", "-id"], name="assessment_queue"),
            # The whole queue (no stage filter), as the reviewer portal lists it.
            models.Index(fields=["-updated_at", "-id"], name="assessment_recent"),
            # The queue filtered to one department.
            models.Index(fields=["department", "-updated_at", "-id"], name="assessment_by_department"),
            # The queue narrowed to one reviewer's cases ("Mine").
            models.Index(fields=["reviewer", "-updated_at", "-id"], name="assessment_by_reviewer"),
        ]

    def __str__(self) -> str:
        return self.public_id



class ApplicantProfile(models.Model):
    assessment = models.OneToOneField(
        Assessment, primary_key=True, on_delete=models.CASCADE, related_name="profile"
    )
    date_of_birth = models.DateField(null=True, blank=True)
    town = models.CharField(max_length=120, blank=True)
    nationality = models.CharField(max_length=80, blank=True)
    national_id_number = EncryptedTextField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "applicant_profile"


class AnswerValue(models.Model):
    assessment = models.ForeignKey(Assessment, on_delete=models.CASCADE, related_name="answers", db_index=False)  # indexed by the composite index or unique rule that starts with it
    # The question's code (A1, PC19 ...), stable across questionnaire versions; validated against the
    # assessment's version in code. A foreign key to one version's row would orphan a draft when the
    # question settings change.
    qid = models.CharField(max_length=10)
    # Yes, No or N/A for a choice question; the words given for a text question. Checked against
    # the question in code (views/form.py), since which one applies depends on the question.
    value = models.CharField(max_length=TEXT_ANSWER_MAX)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "answer"
        constraints = [
            models.UniqueConstraint(fields=["assessment", "qid"], name="answer_one_per_question"),
        ]


def _evidence_path(instance: "EvidenceFile", filename: str) -> str:
    # Never the uploaded name: a random key, so paths cannot be guessed or collide.
    return f"evidence/{instance.assessment_id}/{uuid.uuid7().hex}"


class CaseDocument(models.Model):
    """A document the applicant uploaded to their application's library ("Your documents"),
    attached to questions from there (each attachment is an EvidenceFile sharing its stored file).
    Detaching leaves it here; deleting it here detaches it everywhere."""

    public_id = models.UUIDField(default=uuid.uuid7, unique=True, editable=False)
    assessment = models.ForeignKey(Assessment, on_delete=models.CASCADE, related_name="library")
    file = models.FileField(upload_to=_evidence_path, max_length=200)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size_bytes = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    uploaded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "case_document"
        constraints = [
            # The same file uploaded twice is one document.
            models.UniqueConstraint(fields=["assessment", "sha256"], name="case_document_once"),
        ]
        # Whether a stored file is still used before it is deleted (shared with its attachments).
        indexes = [models.Index(fields=["file"], name="case_document_by_file")]

    def __str__(self) -> str:
        return self.original_name


class EvidenceFile(models.Model):
    public_id = models.UUIDField(default=uuid.uuid7, unique=True, editable=False)
    assessment = models.ForeignKey(Assessment, on_delete=models.CASCADE, related_name="evidence")
    # The library document it attaches (sharing its stored file); null for one attached before the
    # library existed.
    document = models.ForeignKey(
        CaseDocument, null=True, blank=True, on_delete=models.SET_NULL, related_name="attachments"
    )
    # The question's code, or "CV" for the CV, which sits outside the 15 questions.
    qid = models.CharField(max_length=10)
    option_code = models.CharField(max_length=60)
    doc_type = models.CharField(max_length=60)
    role = models.CharField(max_length=10, choices=EvidenceRole.choices, default=EvidenceRole.PRIMARY)
    description = models.CharField(max_length=200, blank=True)
    file = models.FileField(upload_to=_evidence_path, max_length=200)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size_bytes = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    uploaded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    # Set when a resubmission replaces the file; the old one is kept for the record.
    superseded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "evidence_file"
        constraints = [_in_choices("role", EvidenceRole, "evidence_role_valid")]
        indexes = [
            # Whether a stored file is still used before it is deleted (a file is shared with the
            # library, and kept for the submissions that sent it).
            models.Index(fields=["file"], name="evidence_file_by_file"),
            models.Index(
                fields=["assessment", "qid"],
                condition=Q(superseded_at__isnull=True),
                name="evidence_current",
            ),
        ]

    def __str__(self) -> str:
        return self.original_name

    @property
    def identity(self) -> tuple[str, str]:
        """What makes it the same document as one sent before: its contents and its document type.
        The same file filed as another type is new (the engine checks it as that type); attached
        again as the same type, as another role, or with its description reworded, it is not."""
        return (self.sha256, self.option_code)


# ---------------------------------------------------------------------------------------------
# Engine runs, the reviewer's work, and the outcome
# ---------------------------------------------------------------------------------------------


class Submission(models.Model):
    """One run of the Data Authentication API. A resubmission is a new row; nothing is updated in
    place except the run's own progress."""

    assessment = models.ForeignKey(Assessment, on_delete=models.PROTECT, related_name="submissions", db_index=False)  # indexed by the composite index or unique rule that starts with it
    attempt_no = models.PositiveSmallIntegerField()
    engine_request_id = models.CharField(max_length=64, null=True, blank=True)
    status = models.CharField(max_length=10, choices=RunStatus.choices, default=RunStatus.QUEUED)
    outcome = models.CharField(max_length=20, choices=Outcome.choices, null=True, blank=True)
    engine_version = models.CharField(max_length=20, blank=True)
    version = models.ForeignKey(QuestionnaireVersion, on_delete=models.PROTECT, related_name="+")
    # Exactly what was sent, so any outcome can be reconstructed later.
    payload = models.JSONField()
    evidence_files = models.ManyToManyField(EvidenceFile, related_name="submissions", db_table="submission_evidence")
    submitted_at = models.DateTimeField(auto_now_add=True)
    authenticated_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    last_polled_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)
    # When the reviewer accepted every finding of a run that did not authenticate CLEAR and the
    # engine agreed to score it anyway (POST /authentication/force-score): the same run then goes on
    # to the score and the assessment. Null for a run never forced.
    score_forced_at = models.DateTimeField(null=True, blank=True)
    # Why the engine would not score it after all, when it would not, for the reviewer.
    force_error = models.TextField(blank=True)

    class Meta:
        db_table = "submission"
        constraints = [
            models.UniqueConstraint(fields=["assessment", "attempt_no"], name="submission_attempt_unique"),
            models.UniqueConstraint(fields=["engine_request_id"], name="submission_request_id_unique"),
            _in_choices("status", RunStatus, "submission_status_valid"),
            models.CheckConstraint(
                condition=Q(outcome__isnull=True) | Q(outcome__in=Outcome.values),
                name="submission_outcome_valid",
            ),
        ]
        indexes = [
            # Unfinished runs, longest-unchecked first: what the engine follow-up reads. Partial, so
            # it stays as small as the number of runs in progress however many have ever been made.
            models.Index(
                F("last_polled_at").asc(nulls_first=True),
                condition=Q(status__in=["queued", "running"]),
                name="submission_in_flight",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.assessment.public_id} · run {self.attempt_no}"


class SubmissionDocument(models.Model):
    """The engine's documents, stored whole and never queried, apart from the submission row so
    listing submissions never loads them."""

    submission = models.OneToOneField(
        Submission, primary_key=True, on_delete=models.CASCADE, related_name="documents"
    )
    authentication = models.JSONField(null=True, blank=True)
    score = models.JSONField(null=True, blank=True)
    assessment = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "submission_document"

    def __str__(self) -> str:
        return str(self.submission)


class QuestionResult(models.Model):
    """Per-question outcome, extracted from the engine's document so flags are plain SQL."""

    submission = models.ForeignKey(
        Submission, on_delete=models.CASCADE, related_name="question_results", db_index=False
    )  # indexed by the composite index or unique rule that starts with it
    qid = models.CharField(max_length=10)
    status = models.CharField(max_length=16, choices=ResultStatus.choices)
    verdict = models.CharField(max_length=30, blank=True)
    confidence = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)

    class Meta:
        db_table = "question_result"
        constraints = [
            models.UniqueConstraint(fields=["submission", "qid"], name="question_result_unique"),
            _in_choices("status", ResultStatus, "question_result_status_valid"),
        ]
        indexes = [
            models.Index(fields=["submission"], condition=Q(status="issue"), name="question_result_issues"),
        ]


class Ruling(models.Model):
    submission = models.ForeignKey(Submission, on_delete=models.PROTECT, related_name="rulings", db_index=False)  # indexed by the composite index or unique rule that starts with it
    qid = models.CharField(max_length=10)
    verdict = models.CharField(max_length=10, choices=Verdict.choices)
    comment = models.TextField()
    reviewer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ruling"
        constraints = [
            models.UniqueConstraint(fields=["submission", "qid"], name="ruling_one_per_flag"),
            _in_choices("verdict", Verdict, "ruling_verdict_valid"),
        ]


class Score(models.Model):
    submission = models.OneToOneField(Submission, on_delete=models.PROTECT, related_name="score")
    source = models.CharField(max_length=20, choices=ScoreSource.choices)
    risk_score = models.DecimalField(max_digits=6, decimal_places=3)
    normalised = models.DecimalField(max_digits=7, decimal_places=6)
    band = models.CharField(max_length=10, choices=Band.choices)
    knock_out = models.BooleanField()
    recommendation = models.CharField(max_length=200)
    lines = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "score"
        constraints = [
            _in_choices("source", ScoreSource, "score_source_valid"),
            _in_choices("band", Band, "score_band_valid"),
        ]


class Decision(models.Model):
    assessment = models.OneToOneField(Assessment, on_delete=models.PROTECT, related_name="decision")
    verdict = models.CharField(max_length=10, choices=Verdict.choices)
    remarks = models.TextField()
    reviewer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    decided_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "decision"
        constraints = [_in_choices("verdict", Verdict, "decision_verdict_valid")]


class QuestionnaireLock(models.Model):
    """Who is editing a department's questions now: one admin at a time, so two never change them
    at once. Kept alive by the editor while it is open (seen_at); one not seen for
    QUESTIONNAIRE_LOCK_IDLE_SECONDS has lapsed and can be taken. `token` tells the holder's browser
    tabs apart."""

    department = models.OneToOneField(
        Department, primary_key=True, on_delete=models.CASCADE, related_name="questionnaire_lock"
    )
    holder = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    token = models.CharField(max_length=64)
    started_at = models.DateTimeField()
    seen_at = models.DateTimeField()

    class Meta:
        db_table = "questionnaire_lock"


class AuditEvent(models.Model):
    """Append-only record of who did what. Refers to assessments by public id rather than a
    foreign key, so the trail survives the removal of an unsubmitted assessment."""

    occurred_at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    action = models.CharField(max_length=40)
    assessment_ref = models.CharField(max_length=20, blank=True)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "audit_event"
        indexes = [
            models.Index(fields=["assessment_ref", "occurred_at"], name="audit_by_assessment"),
            # Time-ordered inserts: a BRIN index stays tiny however large the table grows.
            BrinIndex(fields=["occurred_at"], name="audit_occurred_brin"),
        ]

from django.urls import path

from .views.admin_panel import (
    AdminDepartmentDetailView, AdminDepartmentListView, AdminOverviewView, AdminUserDetailView, AdminUserListView,
)
from .views.assessments import AssessmentDetailView, AssessmentListView, ContinueView, PrefillView
from .views.case import (
    AssignView, CaseView, ClaimView, CompleteReviewView, DecisionView, ForceScoreView, HighlightView, ResubmitView, RetryView,
    RulingView, SubmitView,
)
from .views.catalogue import (
    CatalogueView, DepartmentListView, QuestionnaireImpactView, QuestionnaireLockView, QuestionnaireView,
)
from .views.evidence import (
    DocumentDetailView, DocumentFileView, DocumentListView, EvidenceDetailView, EvidenceFileView, EvidenceUploadView,
)
from .views.form import FormResetView, FormView
from .views.session import SessionView

A = "assessments/<str:public_id>"

urlpatterns = [
    path("session", SessionView.as_view(), name="session"),
    # The reviewer's admin panel (not Django's admin site, which is at /admin/).
    path("admin/overview", AdminOverviewView.as_view(), name="admin-overview"),
    path("admin/users", AdminUserListView.as_view(), name="admin-users"),
    path("admin/users/<int:user_id>", AdminUserDetailView.as_view(), name="admin-user"),
    path("admin/departments", AdminDepartmentListView.as_view(), name="admin-departments"),
    path("admin/departments/<slug:key>", AdminDepartmentDetailView.as_view(), name="admin-department"),
    path("catalogue", CatalogueView.as_view(), name="catalogue"),
    path("departments", DepartmentListView.as_view(), name="departments"),
    path("questionnaire", QuestionnaireView.as_view(), name="questionnaire"),
    path("questionnaire/impact", QuestionnaireImpactView.as_view(), name="questionnaire-impact"),
    path("questionnaire/lock", QuestionnaireLockView.as_view(), name="questionnaire-lock"),
    path("assessments", AssessmentListView.as_view(), name="assessments"),
    # Before the assessment pattern below, which would otherwise take "prefill" as an id.
    path("assessments/prefill", PrefillView.as_view(), name="assessments-prefill"),
    path(A, AssessmentDetailView.as_view(), name="assessment"),
    path(f"{A}/continue", ContinueView.as_view(), name="continue"),
    path(f"{A}/form", FormView.as_view(), name="form"),
    path(f"{A}/form/reset", FormResetView.as_view(), name="form-reset"),
    path(f"{A}/evidence", EvidenceUploadView.as_view(), name="evidence-upload"),
    path(f"{A}/evidence/<uuid:evidence_id>", EvidenceDetailView.as_view(), name="evidence"),
    path(f"{A}/evidence/<uuid:evidence_id>/file", EvidenceFileView.as_view(), name="evidence-file"),
    # The application's library ("Your documents"): uploaded first, attached to questions after.
    path(f"{A}/documents", DocumentListView.as_view(), name="documents"),
    path(f"{A}/documents/<uuid:document_id>", DocumentDetailView.as_view(), name="document"),
    path(f"{A}/documents/<uuid:document_id>/file", DocumentFileView.as_view(), name="document-file"),
    path(f"{A}/submit", SubmitView.as_view(), name="submit"),
    path(f"{A}/resubmit", ResubmitView.as_view(), name="resubmit"),
    path(f"{A}/retry", RetryView.as_view(), name="retry"),
    path(f"{A}/case", CaseView.as_view(), name="case"),
    path(f"{A}/rulings/<str:qid>", RulingView.as_view(), name="ruling"),
    path(f"{A}/decision", DecisionView.as_view(), name="decision"),
    path(f"{A}/claim", ClaimView.as_view(), name="claim"),
    path(f"{A}/assign", AssignView.as_view(), name="assign"),
    path(f"{A}/force-score", ForceScoreView.as_view(), name="force-score"),
    path(f"{A}/complete-review", CompleteReviewView.as_view(), name="complete-review"),
    path(f"{A}/highlights/<str:name>", HighlightView.as_view(), name="highlight"),
]

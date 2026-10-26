from django.http import Http404
from rest_framework.exceptions import APIException, PermissionDenied

from ..models import Assessment, Stage, User


class Conflict(APIException):
    status_code = 409
    default_detail = "This change is not possible in the assessment's current state."


# The codes a 409 can carry, for the frontend to act on (rather than on the wording).
HELD_BY_OTHER = "held_by_other"  # another admin is reviewing the case
LOCK_HELD = "lock_held"  # someone else (or another tab) is editing the department's questions


def coded_conflict(code: str, message: str) -> Conflict:
    """A 409 with a machine-readable code beside the message: {"detail": ..., "code": ...}."""
    return Conflict({"detail": message, "code": code})


def holder_payload(assessment: Assessment) -> dict | None:
    """Who is reviewing the case (for the reviewer side only), and since when."""
    if assessment.reviewer_id is None:
        return None
    return {"email": assessment.reviewer.email, "since": assessment.claimed_at}


class ServiceUnavailable(APIException):
    status_code = 503
    default_detail = "The authentication service is temporarily unavailable. Try again shortly."


def require_owner(user: User, assessment: Assessment) -> None:
    """Only the applicant edits their own form; a reviewer may read it but not change it."""
    if assessment.applicant_id != user.id:
        raise PermissionDenied("Only the applicant can change this assessment.")


def require_not_own(user: User, assessment: Assessment) -> None:
    """A reviewer never rules on or decides their own application (possible once an applicant is
    given reviewer access at /admin/)."""
    if assessment.applicant_id == user.id:
        raise PermissionDenied("You cannot review your own application. Another reviewer must do it.")


def lock(assessment: Assessment) -> Assessment:
    """The assessment's row, locked until the transaction ends. A stage check made on it holds
    while the change is written: a submit at the same moment waits, or has already moved the
    stage and the check refuses. Checks made before the transaction are only a quick early answer."""
    try:
        return Assessment.objects.select_for_update().get(pk=assessment.pk)
    except Assessment.DoesNotExist:
        raise Http404 from None  # removed while this request was on its way


def require_editable(assessment: Assessment) -> None:
    if assessment.stage != Stage.NOT_SUBMITTED:
        raise Conflict("This assessment has been submitted and can no longer be changed.")

"""Rules for changing accounts, shared by the admin panel and Django's admin site."""

from django.db import connection
from django.utils import timezone

from . import audit
from .models import Assessment, Role, Stage, User

# Stages after which an application needs nothing more from its applicant.
DECIDED = (Stage.ACCEPTED, Stage.REJECTED)


def undecided(user: User) -> list[str]:
    """The user's own applications not decided yet. Even a submitted one can still come back to
    them as the applicant (the reviewer may ask for new evidence)."""
    return list(
        Assessment.objects.filter(applicant=user).exclude(stage__in=DECIDED)
        .order_by("public_id").values_list("public_id", flat=True)
    )


# Taken, for one account, by a change to its access and by a case being given to it: the two wait
# for each other, so a case is never given to someone in the moment they lose its department.
_ACCOUNT_LOCK = 7_202


_ACCESS_CHANGES_LOCK = 7_203


def lock_access_changes() -> None:
    """Inside a transaction: waits for any other change to an account's access (role, departments,
    switched on or off) to finish, so they are made one after another."""
    with connection.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", [_ACCESS_CHANGES_LOCK])


def lock_account(user_id: int) -> None:
    """Inside a transaction: waits for any other change to this account's access, or case being
    given to it, to finish."""
    with connection.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", [_ACCOUNT_LOCK, user_id])


def held_cases(user: User):
    """The cases this account is reviewing: submitted, not decided."""
    from .workflow import REVIEWABLE

    return Assessment.objects.filter(reviewer=user, stage__in=REVIEWABLE)


def release_lost_work(user: User, actor: User | None) -> int:
    """After a change to an account (inside its transaction): the cases it was reviewing that it can
    no longer act on go back to the queue, untaken, for the department's other admins. Returns how
    many."""
    from .question_locks import release_lost

    # A case being given to them at this moment finishes first, and is then seen (and released).
    lock_account(user.pk)
    # An editing lock on questions they no longer work on goes too.
    release_lost(user)
    if user.is_active and user.role == Role.SUPERUSER:
        return 0  # every department is still theirs
    held = held_cases(user)
    if user.is_active and user.role == Role.REVIEWER:
        held = held.exclude(department__in=user.departments.all())
    lost = list(held.select_for_update().values_list("public_id", flat=True))
    if lost:
        # Marked as changed now, so they come to the top of the queue as a release would.
        Assessment.objects.filter(public_id__in=lost).update(reviewer=None, claimed_at=None, updated_at=timezone.now())
        for ref in lost:
            audit.record(actor, "case.release", assessment_ref=ref,
                         metadata={"from": user.email, "reason": "access changed"})
    return len(lost)


def other_super_users(user: User) -> bool:
    """Whether a super user other than this one can sign in. Inside a transaction: every active
    super user's row is locked (in one order), so two super users taking each other's access at
    the same moment are checked one after the other, and the second is refused."""
    others = list(
        User.objects.select_for_update().filter(role=Role.SUPERUSER, is_active=True).order_by("pk")
        .values_list("pk", flat=True)
    )
    return any(pk != user.pk for pk in others)


def promotion_refused(user: User) -> str | None:
    """Why the user cannot be given reviewer access yet, if they cannot. A reviewer is sent to the
    reviewer pages, so an application of theirs that is not decided yet could reach a step they,
    as its applicant, could no longer take."""
    pending = undecided(user)
    if not pending:
        return None
    return (
        f"{user.email} still has applications that are not decided ({', '.join(pending)}). They must "
        "be decided, or removed if not submitted yet, before reviewer access is given."
    )

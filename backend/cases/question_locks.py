"""One admin at a time edits a department's questions.

The first to change something takes the department's lock; the others see who is editing and read
the questions until the lock is given back (on applying, restoring, discarding or leaving) or lapses
(QUESTIONNAIRE_LOCK_IDLE_SECONDS without word from the editor). The super user can take it over. A
holder's browser tabs are told apart by a token, so a second tab of theirs does not edit beside the
first. Every check runs with the department's row locked, so two admins starting at the same moment
are taken one after the other. Publishing checks the lock too, and keeps its own check that the
edit was made from the version in force.
"""

import datetime

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from . import audit
from .models import Department, QuestionnaireLock, User
from .views.common import LOCK_HELD, coded_conflict


def _idle() -> datetime.timedelta:
    return datetime.timedelta(seconds=settings.QUESTIONNAIRE_LOCK_IDLE_SECONDS)


def live_lock(department: Department) -> QuestionnaireLock | None:
    """The department's lock, if someone holds it, it has not lapsed, and they still work on the
    department (one who lost it, or was switched off, holds nothing)."""
    from .permissions import may_manage

    lock = QuestionnaireLock.objects.filter(department=department).select_related("holder").first()
    if lock is None or lock.seen_at <= timezone.now() - _idle():
        return None
    if not (lock.holder.is_active and may_manage(lock.holder, department)):
        return None
    return lock


def lock_payload(lock: QuestionnaireLock | None, user: User | None = None, token: str | None = None) -> dict | None:
    """Who holds the lock, and whether it is the asking tab's own (`thisTab`: an editor reloaded
    after a refused save takes up the lock it still holds, rather than reading as someone else)."""
    if lock is None:
        return None
    return {
        "email": lock.holder.email, "since": lock.started_at, "until": lock.seen_at + _idle(),
        "thisTab": bool(user is not None and token and lock.holder_id == user.pk and lock.token == token),
    }


def _held_by_other(lock: QuestionnaireLock, user: User) -> str:
    if lock.holder_id == user.pk:
        return "You are editing these questions in another tab. Carry on there, or edit here instead."
    since = timezone.localtime(lock.started_at).strftime("%H:%M")
    return f"{lock.holder.email} is editing these questions (since {since}). They can be changed once they finish."


def take(department: Department, user: User, token: str, take_over: bool = False) -> QuestionnaireLock:
    """Takes or keeps the lock for this user's tab (a call while holding it keeps it alive). Taking
    it from someone else's tab needs take_over: the super user's, or the same user's other tab."""
    from .accounts import lock_account
    from .permissions import may_manage

    with transaction.atomic():
        # Checked against the account as it is now: a change to its access at this moment either
        # finishes first (and this is refused) or waits, and then gives this lock back.
        lock_account(user.pk)
        fresh = User.objects.get(pk=user.pk)
        if not (fresh.is_active and may_manage(fresh, department)):
            raise PermissionDenied("You do not work on this department.")
        Department.objects.select_for_update().filter(pk=department.pk).first()
        now = timezone.now()
        held = live_lock(department)
        if held is not None and not (held.holder_id == user.pk and held.token == token):
            allowed = take_over and (held.holder_id == user.pk or user.is_super_user)
            if not allowed:
                raise coded_conflict(LOCK_HELD, _held_by_other(held, user))
            if held.holder_id != user.pk:
                audit.record(user, "questionnaire.take_over", target_type="department", target_id=department.key,
                             metadata={"from": held.holder.email})
        same = held is not None and held.holder_id == user.pk and held.token == token
        lock, _ = QuestionnaireLock.objects.update_or_create(
            department=department,
            defaults={"holder": user, "token": token, "seen_at": now, "started_at": held.started_at if same else now},
        )
        lock.holder = user
        return lock


def give_back(department: Department, user: User, token: str) -> None:
    """The holder's tab is done editing (applied, discarded, or left the page)."""
    QuestionnaireLock.objects.filter(department=department, holder=user, token=token).delete()


def check_for_publish(department: Department, user: User, token: str | None) -> None:
    """Inside the publish's transaction: refused while someone else (or another tab) holds the lock.
    With nobody holding it (it lapsed, or the change comes from elsewhere) the version check decides."""
    Department.objects.select_for_update().filter(pk=department.pk).first()
    held = live_lock(department)
    if held is not None and not (held.holder_id == user.pk and held.token == token):
        if held.holder_id == user.pk:
            raise coded_conflict(LOCK_HELD, "These questions are being edited in another tab of yours. Apply them there.")
        raise coded_conflict(
            LOCK_HELD,
            f"{held.holder.email} took over editing these questions, so your changes were not applied. "
            "They are still on screen."
            if token else _held_by_other(held, user),
        )


def published(department: Department, user: User) -> None:
    """After a publish: the editor that applied it gives the lock back."""
    QuestionnaireLock.objects.filter(department=department, holder=user).delete()


def release_lost(user: User) -> None:
    """After a change to an account: locks on departments it no longer works on are given back."""
    from .permissions import managed_departments

    locks = QuestionnaireLock.objects.filter(holder=user)
    if user.is_active and user.is_reviewer:
        locks = locks.exclude(department__in=managed_departments(user))
    locks.delete()

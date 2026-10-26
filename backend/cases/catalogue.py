"""The question catalogue: each department's questionnaire version in force, its rules, and the
evidence options the engine accepts. Questions are read once per version and cached, since a version never changes
after it is published."""

import re

from django.core.cache import cache

from engine import client as engine

from .models import Answer, AnswerType, Assessment, EvidenceRule, Question, QuestionnaireVersion, Stage

CV_QID = "CV"
# The formats a CV may be uploaded in.
CV_FILE_TYPES = ["pdf", "docx"]
# Formats the reviewer may allow on a question; all are formats the engine reads.
CONFIGURABLE_FILE_TYPES = ["pdf", "xlsx", "csv", "jpg", "png", "docx"]
# The engine files the CV's options under this key; the API serves them as "CV".
_ENGINE_CV_KEY = "cv_verification"
_OPTIONS_CACHE_KEY = "catalogue:evidence-options"
_OPTIONS_TTL_SECONDS = 6 * 60 * 60


def active_version(department) -> QuestionnaireVersion:
    """The questionnaire in force for a department (given as a Department or its id): each
    department has its own."""
    department_id = getattr(department, "pk", department)
    return QuestionnaireVersion.objects.get(is_active=True, department_id=department_id)


def with_questions(departments):
    """The departments (a Department queryset) whose questionnaire in force has a question: those
    set up to take applications. One with none waits for its admins to add some."""
    return departments.filter(
        questionnaire_versions__is_active=True, questionnaire_versions__questions__isnull=False
    ).distinct()


def has_questions(department) -> bool:
    department_id = getattr(department, "pk", department)
    return Question.objects.filter(version__department_id=department_id, version__is_active=True).exists()


def active_versions(department_ids) -> dict[int, QuestionnaireVersion]:
    """department id -> its questionnaire in force, for several departments in one query."""
    return {
        v.department_id: v
        for v in QuestionnaireVersion.objects.filter(is_active=True, department_id__in=set(department_ids))
    }


def version_for(assessment: Assessment) -> QuestionnaireVersion:
    """The settings an assessment is held to: its department's in force until it is submitted, then
    the ones it was submitted under, so a later change never moves the goalposts mid-case."""
    if assessment.stage == Stage.NOT_SUBMITTED:
        return active_version(assessment.department_id)
    return assessment.version


def questions(version_id: int) -> dict[str, Question]:
    """qid -> question for one version, in form order. Cached: a published version is immutable.
    The key names the shape of what is cached (v2: with answer types and added questions), so
    copies cached by an earlier release, without those fields, are never read back."""
    key = f"catalogue:questions:v2:{version_id}"
    found = cache.get(key)
    if found is None:
        found = {
            q.qid: q
            for q in Question.objects.filter(version_id=version_id).select_related("section").order_by("position")
        }
        cache.set(key, found, None)
    return found


def default_answer(question: Question) -> str:
    """What a question reads before it is answered: No for a choice (what a blank form starts
    from), nothing for a text question."""
    return "" if question.answer_type == AnswerType.TEXT else Answer.NO


def evidence_required(question: Question, answer: str) -> bool:
    if question.evidence_required == EvidenceRule.NEVER:
        return False
    if question.answer_type == AnswerType.TEXT:
        # Words are not Yes or No: a text question either always takes a document or never does.
        return question.evidence_required == EvidenceRule.ALWAYS
    if answer == Answer.NA:
        return False
    if question.evidence_required == EvidenceRule.ALWAYS:
        return True
    return answer == Answer.YES


def evidence_options() -> dict[str, list[dict]]:
    """qid (and "CV") -> the options the engine reads, cached for a few hours."""
    options = cache.get(_OPTIONS_CACHE_KEY)
    if options is None:
        raw = engine.evidence_options()["questions"]
        options = {(CV_QID if qid == _ENGINE_CV_KEY else qid): items for qid, items in raw.items()}
        cache.set(_OPTIONS_CACHE_KEY, options, _OPTIONS_TTL_SECONDS)
    return options


def all_engine_options() -> list[dict]:
    """Every document type the engine offers for any question (not the CV's), once each: what a
    reviewer chooses from for a question the engine has no list of its own for."""
    seen: dict[str, dict] = {}
    for qid, items in evidence_options().items():
        if qid == CV_QID:
            continue
        for item in items:
            seen.setdefault(item["code"], item)
    return list(seen.values())


def options_by_code() -> dict[str, dict]:
    """The engine's document types by code, for looking several up at once."""
    return {o["code"]: o for o in all_engine_options()}


# A document type the reviewer named themselves for a question added here: its code carries the
# name, and the engine reads it as a document of another kind (its generic "other" type).
CUSTOM_PREFIX = "CUSTOM:"
CUSTOM_NAME_MAX = 60 - len(CUSTOM_PREFIX)


def custom_name(code: str) -> str | None:
    """The name in a document type the reviewer named, or None for the engine's own codes."""
    if not code.startswith(CUSTOM_PREFIX):
        return None
    name = code[len(CUSTOM_PREFIX):]
    return name or None


def custom_option(code: str) -> dict | None:
    name = custom_name(code)
    if name is None:
        return None
    return {
        "code": code, "label": name, "display": name, "doc_type": "other", "unprofiled": True,
        "note": "Named in this app's question configuration; the engine reads it as a document of another kind.",
    }


# "Other — please specify": every question offers it, the engine's own and those added here alike,
# for a document none of the listed types fits (the applicant then says what it is).
OTHER_CODE = "OTHER"
_OTHER = {
    "code": OTHER_CODE, "label": "Other — please specify", "display": "document of another kind",
    "doc_type": "other", "unprofiled": True,
}


def chosen_options(codes: list[str], by_code: dict[str, dict] | None = None) -> list[dict]:
    """The document types a question added here takes: those chosen for it, in this order (the
    engine's, and those the reviewer named; unknown codes left out), then "Other — please specify",
    which every question offers. Pass options_by_code() as by_code when looking up several
    questions' at once."""
    if all(custom_name(c) is not None for c in codes):
        by_code = {}  # nothing to look up from the engine
    else:
        by_code = options_by_code() if by_code is None else by_code
    chosen = []
    for c in codes:
        found = custom_option(c) or by_code.get(c)
        if found is not None and found["code"] != OTHER_CODE:
            chosen.append(found)
    # Last, as in the engine's own lists: its entry when the engine's list is to hand.
    chosen.append(by_code.get(OTHER_CODE) or _OTHER)
    return chosen


def options_for(qid: str, question: Question | None = None) -> list[dict]:
    """The document types a question takes: those the reviewer chose for it, if any (a question
    added here), otherwise the engine's own list for its code."""
    if question is not None and question.evidence_options:
        return chosen_options(question.evidence_options)
    return evidence_options().get(qid, [])


# ---- The checks the engine runs on a question's documents --------------------------------------

# The longest check name stored (Question.checks holds up to 60 characters each).
CHECK_MAX = 60
# What a new question that takes documents starts with: every question with documents has them.
DEFAULT_CHECKS = ["Document_Check", "Name_Check"]


def check_name(text: str) -> str | None:
    """A check as the engine names them: words capitalised and joined by underscores, ending in
    "_Check" ("licence validity" gives "Licence_Validity_Check"; "Age_Check" stays as it is).
    None for text with no letters or digits."""
    words = [w for w in re.split(r"[^0-9A-Za-z]+", text) if w]
    if not words:
        return None
    if words[-1].lower() == "check":
        words = words[:-1]
    return "_".join([w[0].upper() + w[1:] for w in words] + ["Check"])


def check_label(name: str) -> str:
    """A check's name in words: "Licence_Validity_Check" reads "Licence validity check" (a word in
    capitals, such as ID, stays as it is)."""
    words = name.split("_")
    return " ".join([words[0]] + [w if w.isupper() and len(w) > 1 else w.lower() for w in words[1:]])


def check_choices() -> list[dict]:
    """Every check a question can be given: those of the questionnaire as first published, in its
    order, then any added on other questions since. Each with its name in words."""
    seen: dict[str, None] = {}
    first = QuestionnaireVersion.objects.order_by("pk").values_list("pk", flat=True).first()
    for checks in Question.objects.filter(version_id=first).order_by("position").values_list("checks", flat=True):
        seen.update(dict.fromkeys(checks))
    others = sorted({c for checks in Question.objects.exclude(version_id=first).values_list("checks", flat=True) for c in checks})
    seen.update(dict.fromkeys(others))
    return [{"name": name, "label": check_label(name)} for name in seen]


def version_options(
    version_id: int, by_code: dict[str, dict] | None = None, *, engine_down_ok: bool = False
) -> dict[str, list[dict]]:
    """The document types chosen for the questions added here in one version, by code: what that
    version's form offers (another department's edition of a question may take others). With
    engine_down_ok, an unreachable engine leaves out the questions that need its list (only names
    typed in here are given) instead of raising."""
    chosen = {qid: q.evidence_options for qid, q in questions(version_id).items() if q.evidence_options}
    if not chosen:
        return {}
    if by_code is None and any(custom_name(c) is None for codes in chosen.values() for c in codes):
        try:
            by_code = options_by_code()
        except engine.EngineUnavailable:
            if not engine_down_ok:
                raise
            chosen = {qid: codes for qid, codes in chosen.items() if all(custom_name(c) for c in codes)}
    return {qid: chosen_options(codes, by_code or {}) for qid, codes in chosen.items()}


def option(qid: str, code: str, question: Question | None = None) -> dict | None:
    return next((o for o in options_for(qid, question) if o["code"] == code), None)


def chosen_codes() -> dict[str, list[str]]:
    """The document type codes chosen here for each question, from the latest version that has the
    question (none listed for one that follows the engine's list there)."""
    # Published versions never change, so what they hold is read again only once a newer one is.
    latest = QuestionnaireVersion.objects.order_by("-pk").values_list("pk", flat=True).first()
    key = f"catalogue:chosen-options:{latest}"
    chosen = cache.get(key)
    if chosen is None:
        chosen = {}
        for qid, codes in Question.objects.order_by("version_id").values_list("qid", "evidence_options"):
            chosen[qid] = codes
        chosen = {qid: codes for qid, codes in chosen.items() if codes}
        cache.set(key, chosen, None)
    return chosen


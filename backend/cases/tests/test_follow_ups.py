"""Follow-up questions: a question asked only when its parent (a Yes/No question in the same
section) has a given answer. Configured in the editor, shown or hidden on the form, sent to the
engine only when asked, and left out of what a run reports on when it was not asked."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from cases import adapt, catalogue, workflow
from cases.models import Assessment, EvidenceFile, Question, QuestionnaireVersion, QuestionResult
from cases.tests import factories as make
from cases.tests.test_questionnaire_edit import NEW, PDF, new_question, structure
from cases.tests.test_workflow import FakeEngine, attach, no_poll_delay  # noqa: F401 (fixture)

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]

# The code of the follow-up these tests add under A1, the first Basic Details question: its
# parent's code, numbered.
FU = "A1-1"


@pytest.fixture
def reviewer(as_user):
    return as_user(make.reviewer())


@pytest.fixture
def applicant(as_user):
    return as_user(make.user("a.nghipandulwa@example.na"))


def nested(reviewer) -> dict:
    """The questionnaire in force as the editor sends it: each follow-up nested under its parent."""
    listed = {q["qid"]: q for q in reviewer.get("/api/questionnaire").json()["current"]["questions"]}
    body = structure(reviewer)
    for section in body["sections"]:
        kept = []
        for q in section["questions"]:
            parent = listed[q["qid"]]["parentQid"]
            if parent:
                owner = next(p for p in section["questions"] if p["qid"] == parent)
                owner.setdefault("followUps", []).append({**q, "showWhen": listed[q["qid"]]["showWhen"]})
            else:
                kept.append(q)
        section["questions"] = kept
    return body


def with_follow_up(reviewer, show_when="Yes", **extra) -> tuple[dict, dict]:
    """The questionnaire with a new follow-up under the first Basic Details question, and that
    parent as sent."""
    body = structure(reviewer)
    parent = body["sections"][0]["questions"][0]
    parent["followUps"] = [new_question("Was it renewed in the last year?", showWhen=show_when, **extra)]
    return body, parent


def publish_follow_up(reviewer, **kwargs) -> str:
    body, parent = with_follow_up(reviewer, **kwargs)
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    return parent["qid"]


def active_questions() -> dict:
    return catalogue.questions(QuestionnaireVersion.objects.get(is_active=True).pk)


# ---- Configuring ---------------------------------------------------------------------------------

def test_a_follow_up_is_published_under_its_parent_and_kept_by_later_versions(reviewer):
    parent = publish_follow_up(reviewer)
    listed = {q["qid"]: q for q in reviewer.get("/api/questionnaire").json()["current"]["questions"]}
    assert listed[FU]["parentQid"] == parent and listed[FU]["showWhen"] == "Yes"
    assert listed[parent]["parentQid"] is None and listed[parent]["showWhen"] is None
    # Asked right after its parent on the form.
    order = list(active_questions())
    assert order.index(FU) == order.index(parent) + 1

    # A settings-only save publishes a new version that keeps the link.
    version = reviewer.get("/api/questionnaire").json()["current"]["version"]
    settings = {"allowedAnswers": ["Yes", "No"], "fileTypes": ["pdf"], "maxFiles": 2}
    saved = reviewer.put("/api/questionnaire", {"version": version, "questions": {FU: settings}})
    assert saved.status_code == 200 and saved.json()["version"] != version
    linked = active_questions()[FU]
    assert linked.parent.qid == parent and linked.show_when == "Yes" and linked.parent.version_id == linked.version_id

    # Sending the whole questionnaire again (follow-ups nested) keeps it too.
    body = nested(reviewer)
    assert [f["qid"] for f in body["sections"][0]["questions"][0]["followUps"]] == [FU]
    body["sections"][0]["questions"][0]["followUps"][0]["text"] = "Was it renewed this year?"
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    assert active_questions()[FU].parent.qid == parent


def test_deleting_a_parent_deletes_its_follow_ups(reviewer):
    parent = publish_follow_up(reviewer)
    body = nested(reviewer)
    body["sections"][0]["questions"].pop(0)  # the parent, and with it its follow-up
    body["sections"][0]["questions"][0]["weight"] += next(
        q["weight"] for q in structure(reviewer)["sections"][0]["questions"] if q["qid"] == parent
    )
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    assert FU not in active_questions() and parent not in active_questions()


def test_only_a_yes_no_question_offering_the_answer_can_have_follow_ups(reviewer):
    # Asked on an answer the parent does not offer.
    body, _ = with_follow_up(reviewer, show_when="N/A")
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400 and "which the parent does not offer" in str(refused.json())

    # Under a question answered in words.
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question(
        "Describe any other directorships held.", answerType="text", allowedAnswers=[], evidenceRequired="never",
        evidenceOptions=[], fileTypes=[], followUps=[new_question(showWhen="Yes")],
    ))
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400 and "Only a Yes/No question" in str(refused.json())

    # A follow-up of a follow-up (one level only): the nested list is not read.
    body, parent = with_follow_up(reviewer)
    parent["followUps"][0]["followUps"] = [new_question("Deeper?", showWhen="Yes")]
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    assert all(q.parent is None or q.parent.parent is None for q in active_questions().values())
    assert QuestionnaireVersion.objects.count() == 2


def test_a_parent_keeps_the_answer_its_follow_ups_are_asked_on(reviewer):
    parent = publish_follow_up(reviewer)
    version = reviewer.get("/api/questionnaire").json()["current"]["version"]
    change = {parent: {"allowedAnswers": ["No", "N/A"], "fileTypes": ["pdf"], "maxFiles": 1}}
    refused = reviewer.put("/api/questionnaire", {"version": version, "questions": change})
    assert refused.status_code == 400 and f"Follow-up {FU}" in str(refused.json()[parent])


# ---- The form ------------------------------------------------------------------------------------

def test_a_follow_up_is_asked_only_on_its_parents_answer(reviewer, applicant):
    parent = publish_follow_up(reviewer)
    aid = reviewer.post("/api/assessments", NEW).json()["id"]

    def entry(form):
        return next(a for a in form["answers"] if a["qid"] == FU)

    hidden = entry(applicant.get(f"/api/assessments/{aid}/form").json())
    assert hidden["parentQid"] == parent and hidden["showWhen"] == "Yes"
    assert hidden["asked"] is False and hidden["evidenceRequired"] is False
    upload = {"file": SimpleUploadedFile("passport.pdf", PDF), "qid": FU, "optionCode": "PASSPORT"}
    refused = applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True)
    assert refused.status_code == 400 and "not asked" in str(refused.json())

    # Yes asks it; answered Yes it needs its document like any other question.
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {parent: "Yes"}})
    form = applicant.patch(f"/api/assessments/{aid}/form", {"answers": {FU: "Yes"}}).json()
    assert entry(form)["asked"] is True and entry(form)["evidenceRequired"] is True
    upload = {"file": SimpleUploadedFile("passport.pdf", PDF), "qid": FU, "optionCode": "PASSPORT"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True).status_code == 201

    # Hidden again, it starts over: its answer is cleared and its document taken off it.
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {parent: "No"}})
    assessment = Assessment.objects.get(public_id=aid)
    assert not assessment.answers.filter(qid=FU).exists()
    assert not EvidenceFile.objects.filter(assessment=assessment, qid=FU, superseded_at__isnull=True).exists()
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {parent: "Yes"}})
    shown = entry(applicant.get(f"/api/assessments/{aid}/form").json())
    assert shown["asked"] is True and shown["value"] == "No"


def test_only_follow_ups_asked_must_be_completed(reviewer):
    body, _ = with_follow_up(
        reviewer, answerType="text", allowedAnswers=[], evidenceRequired="never", evidenceOptions=[], fileTypes=[]
    )
    parent = body["sections"][0]["questions"][0]
    parent["followUps"][0]["text"] = "Describe the renewal."
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    questions = active_questions()
    answers = catalogue.with_defaults(questions, {})
    answers[parent["qid"]] = "No"
    assert not any(FU in m for m in workflow.incomplete_for_submission(questions, answers, []))
    answers[parent["qid"]] = "Yes"
    assert any("answers for" in m and FU in m for m in workflow.incomplete_for_submission(questions, answers, []))


def test_the_visibility_rule(reviewer):
    parent = publish_follow_up(reviewer, show_when="No")
    questions = active_questions()
    answers = catalogue.with_defaults(questions, {})
    assert FU in catalogue.asked(questions, {**answers, parent: "No"})
    assert FU not in catalogue.asked(questions, {**answers, parent: "Yes"})
    assert {q for q in questions if q != FU} <= catalogue.asked(questions, {**answers, parent: "Yes"})


# ---- The engine ----------------------------------------------------------------------------------

def test_the_payload_sends_a_follow_up_only_when_asked(reviewer, applicant):
    parent = publish_follow_up(reviewer)
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    assessment = Assessment.objects.get(public_id=aid)
    questions = catalogue.questions(catalogue.version_for(assessment).pk)

    def sent(answers):
        shown = catalogue.asked(questions, catalogue.with_defaults(questions, answers))
        payload = adapt.submission_payload(assessment, questions, answers, None, [], None, shown)
        return {q["qid"]: q for s in payload["sections"] for q in s["questions"]}

    # Not asked: not sent at all (even with an answer left over); everything else still goes.
    hidden = sent({parent: "No", FU: "Yes"})
    assert FU not in hidden and set(hidden) == set(questions) - {FU}
    assert hidden[parent]["parent_qid"] is None and hidden[parent]["show_when"] is None
    assert "asked" not in hidden[parent]

    # Asked: sent like any question, right after its parent, saying what it follows on from.
    asked = sent({parent: "Yes", FU: "Yes"})
    assert asked[FU]["parent_qid"] == parent and asked[FU]["show_when"] == "Yes"
    assert asked[FU]["answer"] == "Yes" and asked[FU]["evidence_required"] is True
    assert asked[FU]["question_weight"] == 0
    order = list(asked)
    assert order.index(FU) == order.index(parent) + 1


def test_a_follow_up_not_asked_is_left_out_of_the_runs_report(monkeypatch, no_poll_delay, reviewer, as_user):  # noqa: F811
    # A4 becomes a follow-up of A1, asked only when A1 is No.
    body = structure(reviewer)
    basic = body["sections"][0]["questions"]
    a4 = next(q for q in basic if q["qid"] == "A4")
    basic.remove(a4)
    # A follow-up has no weight of its own: its share goes to its parent.
    a1 = next(q for q in basic if q["qid"] == "A1")
    a1["weight"] += a4["weight"]
    a1["followUps"] = [{**a4, "weight": 0, "showWhen": "No"}]
    assert reviewer.put("/api/questionnaire", body).status_code == 200, body
    assert Question.objects.get(version__is_active=True, qid="A4").parent.qid == "A1"

    from cases.tests.test_workflow import REQUIRED_DOCUMENTS

    applicant = as_user(make.user("m.vanwyk@example.na"))
    aid = reviewer.post("/api/assessments", {**NEW, "email": "m.vanwyk@example.na"}).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"A1": "Yes"}})
    for qid, code in REQUIRED_DOCUMENTS:
        attach(applicant, aid, qid, code)
    fake = FakeEngine(monkeypatch, "APP001-clear")
    assert applicant.post(f"/api/assessments/{aid}/submit").json()["stage"] == "AUTH_RUNNING"
    sent = {q["qid"] for s in fake.sent[0]["payload"]["sections"] for q in s["questions"]}
    assert "A1" in sent and "A4" not in sent

    # Even if the engine reports on it anyway (this replayed result does), it is left out.

    fake.finish()
    case = reviewer.get(f"/api/assessments/{aid}/case").json()
    reported = {q["qid"] for s in case["authentication"]["sections"] for q in s["questions"]}
    assert "A1" in reported and "A4" not in reported
    lines = {line["qid"] for line in case["score"]["lines"]}
    assert "A1" in lines and "A4" not in lines
    assert not QuestionResult.objects.filter(submission__assessment__public_id=aid, qid="A4").exists()
    assert QuestionResult.objects.filter(submission__assessment__public_id=aid, qid="A1").exists()


def test_a_follow_up_has_no_weight_of_its_own(reviewer):
    # Sent with a weight, it is stored at 0, and the section's weight stays with its own questions.
    body, _ = with_follow_up(reviewer, weight=2)
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    assert active_questions()[FU].weight == 0
    # A settings-only save does not give it one either.
    version = reviewer.get("/api/questionnaire").json()["current"]["version"]
    settings = {"allowedAnswers": ["Yes", "No"], "fileTypes": ["pdf"], "maxFiles": 1, "weight": 3}
    assert reviewer.put("/api/questionnaire", {"version": version, "questions": {FU: settings}}).status_code == 200
    assert active_questions()[FU].weight == 0


def test_a_publish_that_stops_asking_a_follow_up_clears_it_on_drafts(reviewer, applicant):
    parent = publish_follow_up(reviewer)
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {parent: "Yes", FU: "Yes"}})
    upload = {"file": SimpleUploadedFile("passport.pdf", PDF), "qid": FU, "optionCode": "PASSPORT"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True).status_code == 201

    # Now asked on No: with the parent answered Yes, the draft no longer asks it.
    body = nested(reviewer)
    body["sections"][0]["questions"][0]["followUps"][0]["showWhen"] = "No"
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    assessment = Assessment.objects.get(public_id=aid)
    assert not assessment.answers.filter(qid=FU).exists()
    assert not EvidenceFile.objects.filter(assessment=assessment, qid=FU, superseded_at__isnull=True).exists()
    assert assessment.answers.get(qid=parent).value == "Yes"  # the parent's answer stays
    entry = next(a for a in applicant.get(f"/api/assessments/{aid}/form").json()["answers"] if a["qid"] == FU)
    assert entry["asked"] is False


def test_an_answer_to_a_hidden_follow_up_is_not_kept(reviewer, applicant):
    publish_follow_up(reviewer)
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    # The parent is No (as the form starts): an answer sent for the follow-up is cleared again.
    assert applicant.patch(f"/api/assessments/{aid}/form", {"answers": {FU: "Yes"}}).status_code == 200
    assert not Assessment.objects.get(public_id=aid).answers.filter(qid=FU).exists()


def test_the_report_counts_only_the_questions_it_shows(reviewer):
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    assessment = Assessment.objects.get(public_id=aid)
    issue = {"qid": FU, "question": "?", "user_answer": "Yes", "question_status": "issue", "checks": []}
    clear = {"qid": "A1", "question": "?", "user_answer": "Yes", "question_status": "authenticated", "checks": []}
    result = {
        "data_authentication_summary": {"outcome": "RETURN_TO_FILER", "isClean": False, "questionsWithIssues": 1},
        "sections": [{"section": "Basic Details", "issueCount": 1, "questions": [clear, issue]}],
    }
    shown = adapt.authentication(assessment, result, [], {FU})
    assert shown["sections"][0]["issueCount"] == 0 and [q["qid"] for q in shown["sections"][0]["questions"]] == ["A1"]
    assert shown["questionsWithIssues"] == 0 and shown["isClean"] is True
    assert shown["outcome"] == "RETURN_TO_FILER"  # the engine's, which the run already acted on
    # Nothing left out: the engine's figures as they are.
    whole = adapt.authentication(assessment, result, [])
    assert whole["questionsWithIssues"] == 1 and whole["isClean"] is False


def test_follow_ups_are_numbered_under_their_parent(reviewer):
    # Two at once under A1: A1-1 and A1-2, in order. A new question still takes an N code, and
    # a follow-up added under it in the same edit is numbered under that code.
    body, parent = with_follow_up(reviewer)
    parent["followUps"].append(new_question("And the one before it?", showWhen="No"))
    body["sections"][-1]["questions"].append(new_question("New question?", followUps=[new_question(showWhen="Yes")]))
    published = reviewer.put("/api/questionnaire", body)
    assert published.status_code == 200, published.json()
    listed = {q["qid"]: q for q in published.json()["questions"]}
    assert listed["A1-1"]["showWhen"] == "Yes" and listed["A1-2"]["showWhen"] == "No"
    assert listed["A1-2"]["parentQid"] == "A1"
    assert listed["N1"]["parentQid"] is None and listed["N1-1"]["parentQid"] == "N1"

    # A follow-up deleted keeps its code to itself: the next one under A1 is A1-3, not A1-1 again.
    body = nested(reviewer)
    a1 = body["sections"][0]["questions"][0]
    a1["followUps"] = [f for f in a1["followUps"] if f["qid"] != "A1-1"]
    a1["followUps"].append(new_question("A later follow-up?", showWhen="Yes"))
    after = {q["qid"] for q in reviewer.put("/api/questionnaire", body).json()["questions"]}
    assert {"A1-2", "A1-3"} <= after and "A1-1" not in after


def test_the_editor_is_told_every_code_ever_used(reviewer):
    publish_follow_up(reviewer)
    body = nested(reviewer)
    body["sections"][0]["questions"][0]["followUps"] = []  # A1-1 deleted
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    used = reviewer.get("/api/questionnaire").json()["codesUsed"]
    # Deleted codes too, so the code it shows for a new one is the code applying gives it.
    assert FU in used and "A1" in used and used == sorted(used)


def test_a_follow_up_can_use_its_parents_document(reviewer, applicant):
    # A follow-up needing the same kind of document as its parent (A1 always takes one).
    parent = publish_follow_up(reviewer, evidenceRequired="always", evidenceOptions=["NATIONAL_ID"])
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {parent: "Yes"}})
    upload = {"file": SimpleUploadedFile("id.pdf", PDF), "qid": parent, "optionCode": "NATIONAL_ID"}
    on_parent = applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True).json()

    # The same document, from "Your documents", with no new upload.
    reuse = {"documentId": on_parent["documentId"], "qid": FU, "optionCode": "NATIONAL_ID"}
    on_follow_up = applicant.post(f"/api/assessments/{aid}/evidence", reuse, multipart=True)
    assert on_follow_up.status_code == 201 and on_follow_up.json()["documentId"] == on_parent["documentId"]
    form = applicant.get(f"/api/assessments/{aid}/form").json()
    assert len(form["documents"]) == 1
    assert {u["qid"] for u in form["documents"][0]["usedBy"]} == {parent, FU}

    # Both questions carry it to the engine.
    assessment = Assessment.objects.get(public_id=aid)
    questions = catalogue.questions(catalogue.version_for(assessment).pk)
    answers = catalogue.with_defaults(questions, dict(assessment.answers.values_list("qid", "value")))
    payload = adapt.submission_payload(
        assessment, questions, answers, None, list(assessment.evidence.all()), None, catalogue.asked(questions, answers)
    )
    sent = {q["qid"]: q for s in payload["sections"] for q in s["questions"]}
    assert sent[parent]["evidence"] == sent[FU]["evidence"] == [{"doc_type": "national_id", "role": "primary"}]

    # Hiding the follow-up takes it off the follow-up only: the parent keeps it.
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {parent: "No"}})
    held = EvidenceFile.objects.filter(assessment=assessment, superseded_at__isnull=True)
    assert set(held.values_list("qid", flat=True)) == {parent}
    assert assessment.library.count() == 1

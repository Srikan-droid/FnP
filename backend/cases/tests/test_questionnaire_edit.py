"""Editing the whole questionnaire: section weights, sections and questions added or deleted, text
questions, and document types chosen for a question added here."""

import copy
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from cases import adapt, catalogue, workflow
from cases.models import Assessment, AuditEvent, QuestionnaireVersion
from cases.tests import factories as make

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("engine_options")]

PDF = b"%PDF-1.7\n%test document\n"
NEW = {
    "applicantName": "Anna M. Nghipandulwa", "email": "A.Nghipandulwa@Example.NA",
    "entity": "Namib Trust Bank Limited", "position": "Non-Executive Director",
    "reference": "BL-2026-0510", "initiatedOn": "2026-10-01", "department": "banking",
}


@pytest.fixture
def reviewer(as_user):
    return as_user(make.reviewer())


@pytest.fixture
def applicant(as_user):
    return as_user(make.user("a.nghipandulwa@example.na"))


def structure(reviewer) -> dict:
    """The questionnaire in force, in the shape the editor sends it back."""
    current = reviewer.get("/api/questionnaire").json()["current"]
    return {
        "department": "banking",
        "version": current["version"],
        "sections": [
            {
                "name": s["name"], "weight": s["weight"],
                "questions": [
                    {
                        "qid": q["qid"], "text": q["text"], "polarity": q["polarity"], "answerType": q["answerType"],
                        "weight": q["weight"], "allowedAnswers": q["allowedAnswers"], "fileTypes": q["fileTypes"],
                        "maxFiles": q["maxFiles"], "evidenceRequired": q["evidenceRequired"],
                        "evidenceOptions": q["evidenceOptions"],
                    }
                    for q in current["questions"] if q["section"] == s["name"]
                ],
            }
            for s in current["sections"]
        ],
    }


def new_question(text="Has the applicant held a board seat abroad?", weight=0, **extra) -> dict:
    return {
        "qid": None, "text": text, "polarity": "Negative", "answerType": "choice", "weight": weight,
        "allowedAnswers": ["Yes", "No"], "fileTypes": ["pdf"], "maxFiles": 1, "evidenceRequired": "if_yes",
        "evidenceOptions": ["PASSPORT"], **extra,
    }


def test_the_editor_gets_answer_types_and_the_document_types_to_choose_from(reviewer):
    body = reviewer.get("/api/questionnaire").json()
    assert all(q["answerType"] == "choice" and q["evidenceOptions"] == [] for q in body["current"]["questions"])
    codes = {c["code"] for c in body["evidenceOptionChoices"]}
    assert "PASSPORT" in codes and all(set(c) == {"code", "label"} for c in body["evidenceOptionChoices"])


def test_sending_the_questionnaire_unchanged_publishes_nothing(reviewer):
    response = reviewer.put("/api/questionnaire", structure(reviewer))
    assert response.status_code == 200 and response.json()["version"] == make.label()
    assert QuestionnaireVersion.objects.count() == make.versions_at_start()


def test_section_weights_can_change_as_long_as_they_add_up_to_100(reviewer):
    body = structure(reviewer)
    basic, quals = body["sections"][0], body["sections"][1]
    assert (basic["weight"], quals["weight"]) == (4, 18)
    basic["weight"], quals["weight"] = 6, 16
    basic["questions"][0]["weight"], basic["questions"][1]["weight"] = 4.5, 1.5
    quals["questions"][0]["weight"], quals["questions"][1]["weight"] = 6, 10
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200 and response.json()["version"] == make.label() != body["version"]
    assert [s["weight"] for s in response.json()["sections"][:2]] == [6, 16]

    off = structure(reviewer)
    off["sections"][0]["weight"] = 7  # the total is now 101
    off["sections"][0]["questions"][0]["weight"] = 5.5
    refused = reviewer.put("/api/questionnaire", off)
    assert refused.status_code == 400 and "must add up to 100" in refused.json()["detail"]

    mismatch = structure(reviewer)
    mismatch["sections"][0]["questions"][0]["weight"] = 1  # 1 + 1.5 is not the section's 6
    refused = reviewer.put("/api/questionnaire", mismatch)
    assert refused.status_code == 400 and "Basic Details" in refused.json()["sections"]
    assert QuestionnaireVersion.objects.count() == make.versions_at_start() + 1


def test_a_section_and_question_added_reach_drafts_the_payload_and_uploads(reviewer, applicant):
    body = structure(reviewer)
    body["sections"][-1]["weight"] = 3
    body["sections"][-1]["questions"][0]["weight"] = 3
    body["sections"].append({"name": "Foreign Directorships", "weight": 3, "questions": [new_question(weight=3)]})
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    added = next(q for q in response.json()["questions"] if q["section"] == "Foreign Directorships")
    assert added["qid"] == "N1" and added["evidenceOptions"] == ["PASSPORT"] and added["polarity"] == "Negative"
    assert AuditEvent.objects.filter(action="questionnaire.publish", metadata__added=["N1"]).exists()

    # The catalogue offers the chosen document types under the new code.
    catalogue_body = applicant.get("/api/catalogue", department="banking").json()
    # The chosen types, and "Other — please specify", which every question offers.
    assert [o["code"] for o in catalogue_body["evidenceOptions"]["N1"]] == ["PASSPORT", "OTHER"]

    # A draft sees it, and can attach that document type to it.
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    form = applicant.get(f"/api/assessments/{aid}/form").json()
    assert "N1" in [a["qid"] for a in form["answers"]]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"N1": "Yes"}})
    upload = {"file": SimpleUploadedFile("passport.pdf", PDF), "qid": "N1", "optionCode": "PASSPORT"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True).status_code == 201
    other = {"file": SimpleUploadedFile("id.pdf", PDF), "qid": "N1", "optionCode": "NATIONAL_ID"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", other, multipart=True).status_code == 400

    # It goes to the engine with the rest, in its own section.
    assessment = Assessment.objects.get(public_id=aid)
    questions = catalogue.questions(catalogue.version_for(assessment).pk)
    payload = adapt.submission_payload(assessment, questions, {"N1": "Yes"}, None, list(assessment.evidence.all()))
    section = next(s for s in payload["sections"] if s["section"] == "Foreign Directorships")
    assert section["section_weight"] == 3 and section["questions"][0]["qid"] == "N1"
    assert section["questions"][0]["evidence"] == [{"doc_type": "passport", "role": "primary"}]


def test_a_question_added_here_must_name_its_document_types(reviewer):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question(evidenceOptions=[]))
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400 and any("document types" in str(v) for v in refused.json().values())
    body["sections"][-1]["questions"][-1]["evidenceOptions"] = ["NOT_A_TYPE"]
    assert reviewer.put("/api/questionnaire", body).status_code == 400
    # One that takes no documents needs none.
    body["sections"][-1]["questions"][-1].update(evidenceRequired="never", evidenceOptions=[], fileTypes=[])
    assert reviewer.put("/api/questionnaire", body).status_code == 200


def test_a_text_question_is_answered_in_words_and_must_be_answered_to_submit(reviewer, applicant):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(
        new_question("Describe any other directorships held.", answerType="text", allowedAnswers=[],
                     evidenceRequired="never", evidenceOptions=[], fileTypes=[])
    )
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    text_q = next(q for q in response.json()["questions"] if q["answerType"] == "text")
    qid = text_q["qid"]

    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    form = applicant.get(f"/api/assessments/{aid}/form").json()
    entry = next(a for a in form["answers"] if a["qid"] == qid)
    assert entry["value"] == "" and entry["answerType"] == "text" and entry["evidenceRequired"] is False
    saved = applicant.patch(f"/api/assessments/{aid}/form", {"answers": {qid: "  Two, both in Namibia.  "}})
    assert next(a for a in saved.json()["answers"] if a["qid"] == qid)["value"] == "Two, both in Namibia."
    assert applicant.patch(f"/api/assessments/{aid}/form", {"answers": {qid: "x" * 2001}}).status_code == 400
    assert applicant.patch(f"/api/assessments/{aid}/form", {"answers": {qid: 5}}).status_code == 400

    questions = catalogue.questions(catalogue.active_version(Assessment.objects.get(public_id=aid).department).pk)
    answers = {q: catalogue.default_answer(questions[q]) for q in questions}
    assert any("answers for" in m and qid in m for m in workflow.incomplete_for_submission(questions, answers, []))
    answers[qid] = "Two."
    assert not any("answers for" in m for m in workflow.incomplete_for_submission(questions, answers, []))


def test_a_text_question_cannot_take_a_document_only_if_yes(reviewer):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question(answerType="text", allowedAnswers=[]))
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400 and any("text question" in str(v) for v in refused.json().values())


def test_a_choice_question_refuses_anything_else(applicant, reviewer):
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    refused = applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"A1": "Yo"}})
    assert refused.status_code == 400 and "Choose one of" in refused.json()["answers.A1"]


def test_deleted_questions_and_sections_leave_new_drafts_but_not_submitted_cases(reviewer, applicant):
    submitted = make.assessment(public_id="FNP-2026-0700", reference="BL-DEL-1", stage="REVIEW_PENDING")
    body = structure(reviewer)
    collective = body["sections"].pop()  # Collective Suitability, weight 6
    assert collective["name"] == "Collective Suitability"
    body["sections"][0]["weight"] = 10
    body["sections"][0]["questions"] = [body["sections"][0]["questions"][0]]  # A4 deleted
    body["sections"][0]["questions"][0]["weight"] = 10
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    qids = {q["qid"] for q in response.json()["questions"]}
    assert "A4" not in qids and "CS4" not in qids
    assert AuditEvent.objects.filter(action="questionnaire.publish", metadata__deleted=["A4", "CS4"]).exists()

    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    assert {"A4", "CS4"}.isdisjoint(a["qid"] for a in applicant.get(f"/api/assessments/{aid}/form").json()["answers"])
    # A case already submitted keeps the questions it was submitted with.
    kept = catalogue.questions(catalogue.version_for(submitted).pk)
    assert {"A4", "CS4"} <= set(kept)


def test_an_existing_question_can_change_polarity_and_answer_type(reviewer, applicant):
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"A4": "Yes", "Q1": "Yes"}})
    submitted = make.assessment(public_id="FNP-2026-0800", reference="BL-RETYPE", stage="REVIEW_PENDING")
    submitted.answers.create(qid="A4", value="No")
    body = structure(reviewer)
    a1, a4 = body["sections"][0]["questions"]
    a1["polarity"] = "Negative" if a1["polarity"] == "Positive" else "Positive"
    a4.update(answerType="text", allowedAnswers=[], evidenceRequired="never", fileTypes=[])
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    published = {q["qid"]: q for q in response.json()["questions"]}
    assert published["A1"]["polarity"] == a1["polarity"] and published["A4"]["answerType"] == "text"
    assert AuditEvent.objects.filter(action="questionnaire.publish", metadata__retyped=["A4"]).exists()
    # The draft's Yes no longer fits a question answered in words: cleared. Its other answers stay,
    # and a submitted case keeps its answer.
    form = applicant.get(f"/api/assessments/{aid}/form").json()
    answers = {a["qid"]: a["value"] for a in form["answers"]}
    assert answers["A4"] == "" and answers["Q1"] == "Yes"
    assert submitted.answers.get(qid="A4").value == "No"


def test_codes_of_deleted_questions_are_never_given_again(reviewer):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question())
    first = reviewer.put("/api/questionnaire", body).json()
    assert "N1" in {q["qid"] for q in first["questions"]}
    body = structure(reviewer)
    body["sections"][-1]["questions"] = [q for q in body["sections"][-1]["questions"] if q["qid"] != "N1"]
    reviewer.put("/api/questionnaire", body)
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question())
    assert "N2" in {q["qid"] for q in reviewer.put("/api/questionnaire", body).json()["questions"]}


def test_two_sections_cannot_share_a_name_and_an_edit_names_its_version(reviewer):
    body = structure(reviewer)
    body["sections"][1]["name"] = body["sections"][0]["name"].upper()
    assert reviewer.put("/api/questionnaire", body).status_code == 400
    stale = structure(reviewer)
    stale["version"] = "v0"
    assert reviewer.put("/api/questionnaire", stale).status_code == 409
    assert reviewer.put("/api/questionnaire", {"department": "banking", "version": make.label(), "sections": "nope"}).status_code == 400


def test_weights_compare_exactly(reviewer):
    body = copy.deepcopy(structure(reviewer))
    body["sections"][0]["questions"][0]["weight"] = "2.50"
    assert reviewer.put("/api/questionnaire", body).json()["version"] == body["version"]
    assert Decimal("2.50") == Decimal("2.5")


def test_a_deleted_question_can_be_brought_back_as_it_was(reviewer):
    original = structure(reviewer)
    body = copy.deepcopy(original)
    collective = body["sections"].pop()
    body["sections"][0]["weight"] += collective["weight"]
    body["sections"][0]["questions"][0]["weight"] += collective["weight"]
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    original["version"] = reviewer.get("/api/questionnaire").json()["current"]["version"]
    restored = reviewer.put("/api/questionnaire", original)
    assert restored.status_code == 200, restored.json()
    assert "CS4" in {q["qid"] for q in restored.json()["questions"]}
    unknown = structure(reviewer)
    unknown["sections"][0]["questions"][0]["qid"] = "ZZ9"
    assert reviewer.put("/api/questionnaire", unknown).status_code == 400


def test_a_document_a_question_no_longer_asks_for_leaves_drafts(reviewer, applicant):
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    upload = {"file": SimpleUploadedFile("passport.pdf", PDF), "qid": "A1", "optionCode": "PASSPORT"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True).status_code == 201
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"Q1": "Yes"}})
    q1 = {"file": SimpleUploadedFile("degree.pdf", PDF), "qid": "Q1", "optionCode": "DEGREE_CERT"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", q1, multipart=True).status_code == 201
    body = structure(reviewer)
    a1 = body["sections"][0]["questions"][0]
    a1.update(evidenceRequired="never", fileTypes=[])  # A1 no longer asks for a document
    q1_edit = body["sections"][1]["questions"][0]
    q1_edit.update(answerType="text", allowedAnswers=[], evidenceRequired="never", fileTypes=[])  # retyped
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    evidence = {e["qid"] for e in applicant.get(f"/api/assessments/{aid}/form").json()["evidence"]}
    assert "A1" not in evidence and "Q1" not in evidence
    # Nothing left that the form could not show: the submit check finds no broken document.
    assessment = Assessment.objects.get(public_id=aid)
    questions = catalogue.questions(catalogue.version_for(assessment).pk)
    current = list(assessment.evidence.filter(superseded_at__isnull=True))
    assert workflow.evidence_rule_breaks(questions, current) == []


def test_a_form_offers_the_document_types_of_its_own_version(reviewer, applicant):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question(evidenceOptions=["PASSPORT"]))
    reviewer.put("/api/questionnaire", body)
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    entry = next(a for a in applicant.get(f"/api/assessments/{aid}/form").json()["answers"] if a["qid"] == "N1")
    assert [o["code"] for o in entry["evidenceOptions"]] == ["PASSPORT", "OTHER"]
    others = next(a for a in applicant.get(f"/api/assessments/{aid}/form").json()["answers"] if a["qid"] == "A1")
    assert others["evidenceOptions"] is None


def test_every_problem_in_an_edit_is_reported(reviewer):
    body = structure(reviewer)
    body["sections"][1]["name"] = body["sections"][0]["name"]
    body["sections"][0]["weight"] += 1  # total 101
    body["sections"][0]["questions"][0]["weight"] += 1
    body["sections"][-1]["questions"] += [new_question(evidenceOptions=[]), new_question(allowedAnswers=[])]
    refused = reviewer.put("/api/questionnaire", body).json()
    assert "same name" in refused["detail"] and "add up to 100" in refused["detail"]
    new_keys = [k for k in refused if k.startswith("questions.") and "(new)" in k]
    assert len(new_keys) == 2, refused


def test_a_deleted_question_leaves_drafts_with_its_answer_and_documents(reviewer, applicant):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question(evidenceRequired="always"))
    reviewer.put("/api/questionnaire", body)
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"N1": "Yes"}})
    upload = {"file": SimpleUploadedFile("passport.pdf", PDF), "qid": "N1", "optionCode": "PASSPORT"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True).status_code == 201
    body = structure(reviewer)
    body["sections"][-1]["questions"] = [q for q in body["sections"][-1]["questions"] if q["qid"] != "N1"]
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    assessment = Assessment.objects.get(public_id=aid)
    assert not assessment.evidence.filter(qid="N1").exists() and not assessment.answers.filter(qid="N1").exists()


def test_a_question_added_here_is_flagged_and_keeps_the_flag(reviewer):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question())
    added = reviewer.put("/api/questionnaire", body).json()
    flags = {q["qid"]: q["addedHere"] for q in added["questions"]}
    assert flags["N1"] is True and flags["A1"] is False
    # Edited again (its text only), it stays one added here, and still names its document types.
    body = structure(reviewer)
    n1 = next(q for q in body["sections"][-1]["questions"] if q["qid"] == "N1")
    n1["text"] = "Has the applicant held a board seat outside Namibia?"
    again = {q["qid"]: q for q in reviewer.put("/api/questionnaire", body).json()["questions"]}
    assert again["N1"]["addedHere"] is True and again["N1"]["evidenceOptions"] == ["PASSPORT"]


def test_a_text_answer_with_a_nul_character_is_refused(reviewer, applicant):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(
        new_question("Describe it.", answerType="text", allowedAnswers=[], evidenceRequired="never", evidenceOptions=[], fileTypes=[])
    )
    reviewer.put("/api/questionnaire", body)
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    refused = applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"N1": "abc\u0000"}})
    assert refused.status_code == 400 and "answers.N1" in refused.json()
    # A lone surrogate, which JSON allows but the database cannot store, is refused the same way.
    # Sent as raw JSON, escaped, as a client would; the test client cannot encode it itself.
    refused = applicant.client.generic(
        "PATCH", f"/api/assessments/{aid}/form", '{"answers": {"N1": "abc\\ud800"}}',
        content_type="application/json", HTTP_X_CSRFTOKEN=applicant.csrf,
    )
    assert refused.status_code == 400 and "answers.N1" in refused.json()


def test_settings_only_saves_keep_a_text_question_and_added_flag(reviewer):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(
        new_question("Describe it.", answerType="text", allowedAnswers=[], evidenceRequired="always", fileTypes=["pdf"])
    )
    version = reviewer.put("/api/questionnaire", body).json()["version"]
    a1 = {"allowedAnswers": ["Yes", "No"], "fileTypes": ["pdf", "png"], "maxFiles": 1}
    after = {q["qid"]: q for q in reviewer.put("/api/questionnaire", {"department": "banking", "version": version, "questions": {"A1": a1}}).json()["questions"]}
    assert after["N1"]["answerType"] == "text" and after["N1"]["addedHere"] is True and after["N1"]["evidenceOptions"] == ["PASSPORT"]


def test_the_editor_is_told_how_many_drafts_each_change_reaches(reviewer, applicant):
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"A4": "Yes"}})
    upload = {"file": SimpleUploadedFile("passport.pdf", PDF), "qid": "A1", "optionCode": "PASSPORT"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True).status_code == 201
    make.assessment(public_id="FNP-2026-0950", reference="BL-USE-1", stage="REVIEW_PENDING").answers.create(qid="A4", value="No")
    assert reviewer.get("/api/questionnaire/impact").status_code == 400  # it must name the department
    impact = reviewer.get("/api/questionnaire/impact", department="banking").json()
    assert impact == {"drafts": 1, "answered": {"A4": 1}, "documents": {"A1": 1}}
    # Read when needed, not with every load of the editor; reviewers only.
    assert "draftUse" not in reviewer.get("/api/questionnaire").json()
    assert applicant.get("/api/questionnaire/impact").status_code == 403


def test_a_question_added_here_can_take_document_types_named_here(reviewer, applicant):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question(
        evidenceOptions=["PASSPORT", "CUSTOM:  Professional   licence ", "CUSTOM:professional licence", "CUSTOM:"],
    ))
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    added = next(q for q in response.json()["questions"] if q["qid"] == "N1")
    # Spaces tidied, the same name once, an empty one left out.
    assert added["evidenceOptions"] == ["PASSPORT", "CUSTOM:Professional licence"]

    options = applicant.get("/api/catalogue", department="banking").json()["evidenceOptions"]["N1"]
    assert [(o["code"], o["label"], o["doc_type"]) for o in options] == [
        ("PASSPORT", options[0]["label"], "passport"),
        ("CUSTOM:Professional licence", "Professional licence", "other"),
        ("OTHER", options[2]["label"], "other"),
    ]
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    form = applicant.get(f"/api/assessments/{aid}/form").json()
    entry = next(a for a in form["answers"] if a["qid"] == "N1")
    assert [o["code"] for o in entry["evidenceOptions"]] == ["PASSPORT", "CUSTOM:Professional licence", "OTHER"]

    # Attached under its name, it needs no description and reaches the engine as "other".
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"N1": "Yes"}})
    upload = {"file": SimpleUploadedFile("licence.pdf", PDF), "qid": "N1", "optionCode": "CUSTOM:Professional licence"}
    created = applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True)
    assert created.status_code == 201, created.json()
    assert created.json()["docType"] == "other" and created.json()["description"] == "Professional licence"
    unknown = {"file": SimpleUploadedFile("x.pdf", PDF), "qid": "N1", "optionCode": "CUSTOM:Something else"}
    assert applicant.post(f"/api/assessments/{aid}/evidence", unknown, multipart=True).status_code == 400
    assessment = Assessment.objects.get(public_id=aid)
    questions = catalogue.questions(catalogue.version_for(assessment).pk)
    payload = adapt.submission_payload(assessment, questions, {"N1": "Yes"}, None, list(assessment.evidence.all()))
    sent = next(q for s in payload["sections"] for q in s["questions"] if q["qid"] == "N1")
    assert sent["evidence"] == [{"doc_type": "other", "role": "primary"}]


def test_a_document_name_typed_in_is_checked(reviewer):
    body = structure(reviewer)
    body["sections"][-1]["questions"].append(new_question(evidenceOptions=["CUSTOM:" + "x" * (catalogue.CUSTOM_NAME_MAX + 1)]))
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400
    body["sections"][-1]["questions"][-1]["evidenceOptions"] = ["CUSTOM:Bad\x01name"]
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400 and any("control characters" in str(v) for v in refused.json().values())
    # Names alone are enough: the engine's list is not needed.
    body["sections"][-1]["questions"][-1]["evidenceOptions"] = ["CUSTOM:Board minutes"]
    assert reviewer.put("/api/questionnaire", body).status_code == 200



def test_a_question_added_here_always_offers_other_please_specify(reviewer, applicant):
    body = structure(reviewer)
    # Chosen explicitly or not, it is offered once, last.
    body["sections"][-1]["questions"].append(new_question(evidenceOptions=["OTHER", "PASSPORT"]))
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    assert [o["code"] for o in applicant.get("/api/catalogue", department="banking").json()["evidenceOptions"]["N1"]] == ["PASSPORT", "OTHER"]
    # The editor does not offer it as a choice: it is always there.
    choices = [c["code"] for c in reviewer.get("/api/questionnaire").json()["evidenceOptionChoices"]]
    assert "OTHER" not in choices and "PASSPORT" in choices

    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    applicant.patch(f"/api/assessments/{aid}/form", {"answers": {"N1": "Yes"}})
    upload = {"file": SimpleUploadedFile("other.pdf", PDF), "qid": "N1", "optionCode": "OTHER"}
    refused = applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True)
    assert refused.status_code == 400 and "description" in refused.json()  # it says what it is
    upload = {"file": SimpleUploadedFile("other.pdf", PDF), "qid": "N1", "optionCode": "OTHER",
              "description": "Board resolution"}
    created = applicant.post(f"/api/assessments/{aid}/evidence", upload, multipart=True)
    assert created.status_code == 201 and created.json()["docType"] == "other"


def test_a_question_with_only_names_typed_in_offers_other_too(reviewer, applicant):
    from cases import catalogue

    options = catalogue.chosen_options(["CUSTOM:Board minutes"], {})
    assert [o["code"] for o in options] == ["CUSTOM:Board minutes", "OTHER"]
    assert options[-1]["label"] == "Other — please specify"


# ---- Document types chosen for one of the engine's own questions --------------------------------

def _a4(body: dict) -> dict:
    return next(q for s in body["sections"] for q in s["questions"] if q["qid"] == "A4")


def test_the_editor_gets_the_engines_own_list_for_each_question(reviewer):
    lists = reviewer.get("/api/questionnaire").json()["engineEvidenceOptions"]
    assert lists["A4"] == ["NATURALISATION"] and "OTHER" not in lists["A1"] and "CV" not in lists


def _q(body: dict, qid: str) -> dict:
    return next(q for s in body["sections"] for q in s["questions"] if q["qid"] == qid)


def test_an_existing_question_can_take_other_document_types_and_go_back_to_the_engines(reviewer, applicant):
    engine_a1 = reviewer.get("/api/questionnaire").json()["engineEvidenceOptions"]["A1"]
    body = structure(reviewer)
    _q(body, "A1")["evidenceOptions"] = ["PASSPORT", "NATIONAL_ID", "CUSTOM:Residence card"]
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    a1 = next(q for q in response.json()["questions"] if q["qid"] == "A1")
    assert a1["evidenceOptions"] == ["PASSPORT", "NATIONAL_ID", "CUSTOM:Residence card"] and a1["addedHere"] is False

    # The applicant is offered them, "Other — please specify" last as always.
    codes = [o["code"] for o in applicant.get("/api/catalogue", department="banking").json()["evidenceOptions"]["A1"]]
    assert codes == ["PASSPORT", "NATIONAL_ID", "CUSTOM:Residence card", "OTHER"]
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    form = applicant.get(f"/api/assessments/{aid}/form").json()
    assert [o["code"] for o in next(a for a in form["answers"] if a["qid"] == "A1")["evidenceOptions"]] == codes

    # Chosen exactly as the engine lists them again: it follows the engine's list once more.
    body = structure(reviewer)
    _q(body, "A1")["evidenceOptions"] = list(reversed(engine_a1))
    response = reviewer.put("/api/questionnaire", body)
    assert next(q for q in response.json()["questions"] if q["qid"] == "A1")["evidenceOptions"] == []
    codes = [o["code"] for o in applicant.get("/api/catalogue", department="banking").json()["evidenceOptions"]["A1"]]
    assert codes == [*engine_a1, "OTHER"]


def test_an_existing_question_sent_with_no_types_keeps_the_engines(reviewer):
    # What the editor sent before it could choose them: nothing changes.
    response = reviewer.put("/api/questionnaire", structure(reviewer))
    assert response.status_code == 200 and QuestionnaireVersion.objects.count() == make.versions_at_start()
    body = structure(reviewer)
    _a4(body)["evidenceOptions"] = ["NOT_A_TYPE"]
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400 and "not among the AI engine's document types for A4" in str(refused.json())


def test_an_existing_question_takes_only_the_engines_types_for_it(reviewer):
    # PASSPORT is the engine's for A1, not for A4: the engine would not read it under A4.
    body = structure(reviewer)
    _a4(body)["evidenceOptions"] = ["NATURALISATION", "PASSPORT"]
    refused = reviewer.put("/api/questionnaire", body)
    assert refused.status_code == 400 and "PASSPORT is not among" in str(refused.json())
    assert QuestionnaireVersion.objects.count() == make.versions_at_start()


def test_document_types_left_as_they_are_need_nothing_from_the_engine(reviewer, monkeypatch):
    body = structure(reviewer)
    _a4(body)["evidenceOptions"] = ["CUSTOM:Residence card", "NATURALISATION"]
    body["sections"][-1]["questions"].append(new_question(evidenceOptions=["PASSPORT"]))
    body["sections"][-1]["weight"] = body["sections"][-1]["weight"]
    assert reviewer.put("/api/questionnaire", body).status_code == 200

    # The engine is away: a change to anything else still publishes.
    from engine import client
    from django.core.cache import cache

    def away():
        raise client.EngineUnavailable("down")

    monkeypatch.setattr(client, "evidence_options", away)
    cache.clear()
    body = structure(reviewer)
    _a4(body)["text"] = "Is the applicant a naturalised citizen, or a resident?"
    response = reviewer.put("/api/questionnaire", body)
    assert response.status_code == 200, response.json()
    a4 = next(q for q in response.json()["questions"] if q["qid"] == "A4")
    assert a4["evidenceOptions"] == ["CUSTOM:Residence card", "NATURALISATION"]


def test_a_form_on_an_older_version_keeps_the_engines_types_it_was_given(reviewer, applicant):
    aid = reviewer.post("/api/assessments", NEW).json()["id"]
    Assessment.objects.filter(public_id=aid).update(stage="AWAITING_APPLICANT")  # held to v1
    body = structure(reviewer)
    _a4(body)["evidenceOptions"] = ["CUSTOM:Residence card"]
    assert reviewer.put("/api/questionnaire", body).status_code == 200
    # The department's catalogue lists its latest version's types; this form still gets the
    # engine's for A4, in the form and in the catalogue for the form's own version.
    latest = [o["code"] for o in applicant.get("/api/catalogue", department="banking").json()["evidenceOptions"]["A4"]]
    assert latest == ["CUSTOM:Residence card", "OTHER"]
    own = [o["code"] for o in applicant.get("/api/catalogue", assessment=aid).json()["evidenceOptions"]["A4"]]
    assert own == ["NATURALISATION", "OTHER"]
    form = applicant.get(f"/api/assessments/{aid}/form").json()
    a4 = next(a for a in form["answers"] if a["qid"] == "A4")
    assert [o["code"] for o in a4["evidenceOptions"]] == ["NATURALISATION", "OTHER"]
    # A question with nothing chosen in any version still leaves it to the catalogue.
    assert next(a for a in form["answers"] if a["qid"] == "A1")["evidenceOptions"] is None

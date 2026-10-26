"""Loads the five demo applicants from test-data/ into the database: the assessment, the
applicant's details and answers, and every evidence document, unsubmitted.

    manage.py seed_demo            add any demo assessment that is missing
    manage.py seed_demo --reset    remove the demo assessments (with any runs, rulings and
                                   decisions) and load them again; development only
    manage.py seed_demo --submit   then send each unsubmitted one to the engine (billed runs)
"""

import datetime
import hashlib
import json
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from cases import catalogue, validation, workflow
from cases.storage import delete_files
from cases.models import (
    AnswerValue,
    ApplicantProfile,
    Assessment,
    Decision,
    Department,
    CaseDocument,
    EvidenceFile,
    QuestionResult,
    Role,
    Ruling,
    Score,
    Stage,
    Submission,
    User,
)

DEMO = Path(__file__).resolve().parents[2] / "data" / "demo_assessments.json"


class Command(BaseCommand):
    help = "Load the five demo applicants from test-data/ (see the module docstring)."

    def add_arguments(self, parser):
        parser.add_argument("--data", default=str(settings.BASE_DIR.parent / "test-data"),
                            help="The test-data folder (form_data/ and evidence/).")
        parser.add_argument("--reset", action="store_true", help="Remove and reload the demo assessments.")
        parser.add_argument("--submit", action="store_true", help="Send each unsubmitted demo assessment to the engine.")

    def handle(self, *args, data, reset, submit, **options):
        root = Path(data)
        if not (root / "form_data").is_dir() or not (root / "evidence").is_dir():
            raise CommandError(f"{root} has no form_data/ and evidence/ folders.")
        demo = json.loads(DEMO.read_text(encoding="utf-8"))

        if reset and not settings.DEBUG:
            raise CommandError("--reset deletes case records; it only runs with DJANGO_DEBUG=true.")

        # One transaction for the whole reload: anyone using the app meanwhile sees the old cases
        # until the new ones are all in place, never a half-loaded list.
        stored: list[str] = []
        try:
            with transaction.atomic():
                if reset:
                    self._remove([d["id"] for d in demo])
                for d in demo:
                    if Assessment.objects.filter(public_id=d["id"]).exists():
                        self.stdout.write(f"{d['id']} already present, skipped")
                        continue
                    count = self._load(d, root, stored)
                    self.stdout.write(self.style.SUCCESS(f"{d['id']} {d['applicantName']}: {count} documents"))
        except Exception:
            # The rows rolled back; the documents already written to storage must go too.
            delete_files(stored)
            raise

        if submit:
            for d in demo:
                assessment = Assessment.objects.select_related("applicant").get(public_id=d["id"])
                if assessment.stage == Stage.NOT_SUBMITTED:
                    run = workflow.submit(assessment, assessment.applicant)
                    self.stdout.write(f"{d['id']} submitted: {run.status}")

    def _load(self, d: dict, root: Path, stored: list[str]) -> int:
        form = json.loads((root / "form_data" / f"{d['applicantId']}.json").read_text(encoding="utf-8"))
        version = catalogue.active_version(Department.objects.get(key=d["departmentKey"]))
        questions = catalogue.questions(version.pk)
        files: list[tuple[str, str, str, Path]] = []  # qid, doc_type, role, path
        answers: dict[str, str] = {}
        for section in form["sections"]:
            for q in section["questions"]:
                answers[q["qid"]] = q["answer"]
                files += [(q["qid"], e["doc_type"], e.get("role", "primary"), self._file(root, d, e["doc_type"]))
                          for e in q["evidence"]]
        cv = (form.get("profile_review") or {}).get("cv") or form.get("cv_verification")
        if cv:
            files.append((catalogue.CV_QID, cv["doc_type"], "primary", self._file(root, d, cv["doc_type"])))

        self._create(d, form, version, questions, answers, files, stored)
        return len(files)

    def _create(self, d, form, version, questions, answers, files, stored: list[str]) -> None:
        with transaction.atomic():
            applicant = User.objects.get_or_create_for_email(d["email"], Role.APPLICANT)
            assessment = Assessment.objects.create(
                public_id=d["id"],
                applicant=applicant,
                applicant_name=d["applicantName"],
                department=Department.objects.get(key=d["departmentKey"]),
                entity=d["entity"],
                position=d["position"],
                parent_reference=d["reference"],
                initiated_on=datetime.date.fromisoformat(d["initiatedOn"]),
                version=version,
            )
            ApplicantProfile.objects.create(
                assessment=assessment,
                date_of_birth=datetime.date.fromisoformat(form["applicant"]["date_of_birth"]),
                town=form["applicant"]["town"],
                nationality=d["nationality"],
                national_id_number=d["nationalIdNumber"],
                phone=d["phone"],
            )
            AnswerValue.objects.bulk_create(
                [AnswerValue(assessment=assessment, qid=qid, value=v) for qid, v in answers.items() if qid in questions]
            )
            for qid, doc_type, role, path in files:
                self._attach(assessment, applicant, qid, doc_type, role, path, questions, stored)

    @staticmethod
    def _file(root: Path, d: dict, doc_type: str) -> Path:
        matches = sorted((root / "evidence" / d["applicantId"]).glob(f"{doc_type}.*"))
        if not matches:
            raise CommandError(f"{d['applicantId']}: no evidence file for {doc_type}")
        return matches[0]

    @staticmethod
    def _attach(assessment, applicant, qid, doc_type, role, path, questions, stored: list[str]) -> None:
        """Stores one document exactly as an upload at a question would: the same option lookup and
        file checks, the file kept in "Your documents" and the attachment sharing it."""
        option = next((o for o in catalogue.evidence_options().get(qid, []) if o["doc_type"] == doc_type), None)
        if option is None:
            raise CommandError(f"{assessment.public_id} {qid}: no evidence option reads {doc_type}")
        allowed = ["pdf", "docx"] if qid == catalogue.CV_QID else questions[qid].file_types
        with path.open("rb") as fh:
            upload = File(fh, name=path.name)
            try:
                _, content_type = validation.evidence_file(upload, allowed, settings.EVIDENCE_MAX_BYTES)
            except ValidationError as exc:
                raise CommandError(f"{assessment.public_id} {qid} {path.name}: {exc.messages[0]}") from None
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            # One library document per file, however many questions it is attached to.
            document = CaseDocument.objects.filter(assessment=assessment, sha256=sha).first()
            if document is None:
                document = CaseDocument(
                    assessment=assessment, original_name=path.name, content_type=content_type,
                    size_bytes=path.stat().st_size, sha256=sha, uploaded_by=applicant,
                )
                fh.seek(0)
                document.file.save("upload", upload, save=False)
                stored.append(document.file.name)
                document.save()
        evidence = EvidenceFile(
            assessment=assessment, document=document, qid=qid, option_code=option["code"], doc_type=doc_type,
            role=role, original_name=path.name, content_type=content_type, size_bytes=document.size_bytes,
            sha256=sha, uploaded_by=applicant,
        )
        evidence.file.name = document.file.name
        evidence.save()

    def _remove(self, public_ids: list[str]) -> None:
        """Deletes the demo assessments and everything recorded against them, newest records first
        (the schema protects case records, so each is removed explicitly)."""
        with transaction.atomic():
            assessments = Assessment.objects.filter(public_id__in=public_ids)
            submissions = Submission.objects.filter(assessment__in=assessments)
            names = sorted(
                set(EvidenceFile.objects.filter(assessment__in=assessments).values_list("file", flat=True))
                | set(CaseDocument.objects.filter(assessment__in=assessments).values_list("file", flat=True))
            )
            Decision.objects.filter(assessment__in=assessments).delete()
            Score.objects.filter(submission__in=submissions).delete()
            Ruling.objects.filter(submission__in=submissions).delete()
            QuestionResult.objects.filter(submission__in=submissions).delete()
            submissions.delete()
            count, _ = assessments.delete()
            transaction.on_commit(lambda: delete_files(names))
        self.stdout.write(f"Removed the demo assessments ({count} rows).")

from django.db import migrations, models


class Migration(migrations.Migration):
    """The engine keeps one request id per application and tells resubmissions apart by a submission
    version (V001, V002 ...): a run is one request id and version, no longer one request id."""

    dependencies = [
        ("cases", "0013_file_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="submission",
            name="engine_submission_version",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.RemoveConstraint(
            model_name="submission",
            name="submission_request_id_unique",
        ),
        migrations.AddConstraint(
            model_name="submission",
            constraint=models.UniqueConstraint(
                fields=("engine_request_id", "engine_submission_version"), name="submission_request_version_unique"
            ),
        ),
    ]

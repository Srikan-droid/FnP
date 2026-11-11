from django.db import migrations


class Migration(migrations.Migration):
    """Joins the engine's REVIEW outcome (0015, also on server-deploy, where it may already be
    applied) with this branch's line after 0019. Nothing to do: they touch different things."""

    dependencies = [
        ("cases", "0015_submission_outcome_review"),
        ("cases", "0019_merge_submission_version_and_roles"),
    ]

    operations = []

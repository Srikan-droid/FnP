from django.db import migrations


class Migration(migrations.Migration):
    """Joins the two lines of migrations after 0013: the engine's submission versions (0014, also on
    server-deploy, where it may already be applied) and the roles and department questionnaires
    (0014-0018). Nothing to do: they touch different tables."""

    dependencies = [
        ("cases", "0014_submission_engine_version"),
        ("cases", "0018_department_name_unique"),
    ]

    operations = []

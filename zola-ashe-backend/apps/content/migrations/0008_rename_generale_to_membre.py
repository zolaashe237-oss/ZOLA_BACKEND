"""Migration de données : GENERALE → MEMBRE dans toutes les tables concernées."""
from django.db import migrations, models


def _rename_generale_to_membre(apps, schema_editor):
    targets = [
        ("content",   "Formation",        "branch"),
        ("content",   "Audio",            "branche"),
        ("content",   "LibraryPdf",       "branche"),
        ("content",   "LiveSession",      "branche"),
        ("community", "CommunityChannel", "branche"),
    ]
    for app_label, model_name, field in targets:
        try:
            Model = apps.get_model(app_label, model_name)
            Model.objects.filter(**{field: "GENERALE"}).update(**{field: "MEMBRE"})
        except Exception:
            pass


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0007_formation_branch_formation_level_formation_slug_and_more"),
        ("community", "0002_communitychannel_post_post_status_post_title_and_more"),
    ]

    operations = [
        migrations.RunPython(_rename_generale_to_membre, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="formation",
            name="branch",
            field=models.CharField(
                choices=[("MEMBRE", "Membres"), ("FEMME", "Femmes"), ("ENFANT", "Enfants")],
                default="MEMBRE",
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name="audio",
            name="branche",
            field=models.CharField(
                choices=[("MEMBRE", "Membres"), ("FEMME", "Femmes"), ("ENFANT", "Enfants")],
                default="MEMBRE",
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name="librarypdf",
            name="branche",
            field=models.CharField(
                choices=[("MEMBRE", "Membres"), ("FEMME", "Femmes"), ("ENFANT", "Enfants")],
                default="MEMBRE",
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name="livesession",
            name="branche",
            field=models.CharField(
                choices=[("MEMBRE", "Membres"), ("FEMME", "Femmes"), ("ENFANT", "Enfants")],
                default="MEMBRE",
                max_length=10,
            ),
        ),
    ]

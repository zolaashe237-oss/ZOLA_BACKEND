from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ai_quiz", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="aiquestion",
            name="correct_indices",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Pour QCM_MULTI: liste des indices corrects (ex: [0, 2]). Vide pour QCM/QRO.",
            ),
        ),
    ]

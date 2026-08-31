from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0011_quiz_ai_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="quizresult",
            name="last_answers",
            field=models.JSONField(blank=True, null=True, default=None),
        ),
    ]

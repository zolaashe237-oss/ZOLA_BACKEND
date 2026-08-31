from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0010_question_type_criteria"),
    ]

    operations = [
        migrations.AddField(
            model_name="quiz",
            name="generated_by_ai",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="quiz",
            name="ai_source",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AddField(
            model_name="quiz",
            name="niveau",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AddField(
            model_name="quiz",
            name="rang",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]

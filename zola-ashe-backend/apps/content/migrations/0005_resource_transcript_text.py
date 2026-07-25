from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0004_audio_librarypdf_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="resource",
            name="transcript_text",
            field=models.TextField(blank=True),
        ),
    ]

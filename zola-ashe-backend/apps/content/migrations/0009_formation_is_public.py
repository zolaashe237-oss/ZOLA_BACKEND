from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0008_rename_generale_to_membre"),
    ]

    operations = [
        migrations.AddField(
            model_name="formation",
            name="is_public",
            field=models.BooleanField(default=False),
        ),
    ]

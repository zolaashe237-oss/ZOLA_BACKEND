from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0013_merge_20260815_2017"),
    ]

    operations = [
        migrations.AddField(
            model_name="librarypdf",
            name="cover_key",
            field=models.CharField(blank=True, max_length=512),
        ),
    ]

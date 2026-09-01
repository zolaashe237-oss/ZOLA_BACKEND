from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0015_alter_quiz_options"),
    ]

    operations = [
        migrations.AddField(
            model_name="librarypdf",
            name="order",
            field=models.PositiveIntegerField(default=0, db_index=True),
        ),
        migrations.AlterField(
            model_name="librarypdf",
            name="category",
            field=models.CharField(
                max_length=100,
                blank=True,
                choices=[
                    ("Spiritualité",            "Spiritualité"),
                    ("Développement personnel", "Développement personnel"),
                    ("Entrepreneuriat",         "Entrepreneuriat"),
                    ("Création de contenu",     "Création de contenu"),
                ],
            ),
        ),
        migrations.AlterModelOptions(
            name="librarypdf",
            options={"ordering": ["order", "pk"]},
        ),
    ]

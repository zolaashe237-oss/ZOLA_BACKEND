from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_add_user_phone_country_access_levels"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="referral_code",
            field=models.CharField(
                blank=True, db_index=True, max_length=12,
                null=True, unique=True,
                help_text="Code de parrainage unique partageable."),
        ),
    ]

"""Seed le template WhatsApp warn_notification (avertissement de modération)."""
from django.db import migrations


def seed_warn_template(apps, schema_editor):
    WhatsAppTemplate = apps.get_model("notifications", "WhatsAppTemplate")
    WhatsAppTemplate.objects.get_or_create(
        slug="warn_notification",
        defaults={
            "name": "Avertissement de modération",
            "body": (
                "ZOLA ASHÉ - Un avertissement vient d'être ajouté à votre compte. "
                "Motif : {{reason}}. Total : {{nb_warnings}} avertissement(s)."
            ),
            "category": "UTILITY",
            "language": "fr",
            "is_active": True,
            "variables_count": 2,
        },
    )


def reverse_seed(apps, schema_editor):
    WhatsAppTemplate = apps.get_model("notifications", "WhatsAppTemplate")
    WhatsAppTemplate.objects.filter(slug="warn_notification").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0004_whatsapptemplate_meta_template_name_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_warn_template, reverse_seed),
    ]

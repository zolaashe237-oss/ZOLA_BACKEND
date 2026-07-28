"""Seed les templates WhatsApp de base (block_notification, otp_code, payment_confirmation)."""
from django.db import migrations


def seed_templates(apps, schema_editor):
    WhatsAppTemplate = apps.get_model("notifications", "WhatsAppTemplate")

    templates = [
        {
            "name": "Notification de blocage",
            "slug": "block_notification",
            "body": "ZOLA ASHÉ - Votre compte a été bloqué. Motif: {{reason}}",
            "category": "UTILITY",
            "language": "fr",
            "is_active": True,
            "variables_count": 1,
        },
        {
            "name": "Code OTP",
            "slug": "otp_code",
            "body": "ZOLA ASHÉ - Votre code est : {{code}}. Il expire dans {{ttl}} minutes.",
            "category": "AUTHENTICATION",
            "language": "fr",
            "is_active": True,
            "variables_count": 2,
        },
        {
            "name": "Confirmation de paiement",
            "slug": "payment_confirmation",
            "body": "ZOLA ASHÉ - Nous confirmons {{libelle}}. Merci de votre confiance.",
            "category": "UTILITY",
            "language": "fr",
            "is_active": True,
            "variables_count": 1,
        },
    ]

    for tmpl in templates:
        WhatsAppTemplate.objects.get_or_create(
            slug=tmpl["slug"],
            defaults=tmpl,
        )


def reverse_seed(apps, schema_editor):
    WhatsAppTemplate = apps.get_model("notifications", "WhatsAppTemplate")
    WhatsAppTemplate.objects.filter(
        slug__in=["block_notification", "otp_code", "payment_confirmation"]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0002_whatsapp_template"),
    ]

    operations = [
        migrations.RunPython(seed_templates, reverse_seed),
    ]

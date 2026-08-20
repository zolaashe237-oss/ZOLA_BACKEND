"""Ajoute le type de paiement ANNUEL (cotisation annuelle) et seed le plan associé."""
from django.db import migrations, models


NEW_CHOICES = [
    ("INSCRIPTION", "Droit d'inscription"),
    ("COTISATION", "Cotisation mensuelle"),
    ("ANNUEL", "Cotisation annuelle"),
    ("BRANCHE_FEMME", "Accès espace Femme"),
    ("BRANCHE_ENFANT", "Accès espace Enfant"),
    ("DON", "Don volontaire"),
    ("REMBOURSEMENT", "Remboursement"),
]


def seed_annuel_plan(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    SubscriptionPlan.objects.update_or_create(
        kind="ANNUEL",
        defaults={
            "name": "Cotisation annuelle",
            "billing": "ANNUEL",
            "price_total": 24000,
            "nb_tranches": 1,
            "tranche_amount": 24000,
            "description": "Cotisation payée en une fois pour 12 mois d'accès.",
            "is_active": True,
            "access_levels": [],
            "formation_ids": [],
        },
    )


def unseed_annuel_plan(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    SubscriptionPlan.objects.filter(kind="ANNUEL").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0007_alter_subscriptionplan_kind"),
    ]

    operations = [
        migrations.AlterField(
            model_name="payment",
            name="type",
            field=models.CharField(choices=NEW_CHOICES, max_length=20),
        ),
        migrations.AlterField(
            model_name="subscriptionplan",
            name="kind",
            field=models.CharField(choices=NEW_CHOICES, db_index=True, max_length=20, unique=True),
        ),
        migrations.RunPython(seed_annuel_plan, unseed_annuel_plan),
    ]

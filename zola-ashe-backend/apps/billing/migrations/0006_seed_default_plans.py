from django.db import migrations


DEFAULT_PLANS = [
    {
        "kind": "INSCRIPTION",
        "name": "Accès espace membre (annuel)",
        "billing": "ANNUEL",
        "price_total": 47500,
        "nb_tranches": 1,
        "tranche_amount": 47500,
        "description": "Accès complet à l'espace membre pour 12 mois — paiement unique.",
        "is_active": True,
        "access_levels": ["MEMBRE"],
    },
    {
        "kind": "COTISATION",
        "name": "Accès espace membre (mensuel)",
        "billing": "TRANCHES",
        "price_total": 60000,
        "nb_tranches": 6,
        "tranche_amount": 10000,
        "description": "Accès complet — 6 mensualités de 10 000 FCFA.",
        "is_active": True,
        "access_levels": ["MEMBRE"],
    },
    {
        "kind": "BRANCHE_FEMME",
        "name": "Accès espace Femme",
        "billing": "ANNUEL",
        "price_total": 25000,
        "nb_tranches": 1,
        "tranche_amount": 25000,
        "description": "Accès à l'espace Femme pour 12 mois.",
        "is_active": True,
        "access_levels": ["FEMME"],
    },
    {
        "kind": "BRANCHE_ENFANT",
        "name": "Accès espace Enfant",
        "billing": "ANNUEL",
        "price_total": 20000,
        "nb_tranches": 1,
        "tranche_amount": 20000,
        "description": "Accès à l'espace Enfant pour 12 mois.",
        "is_active": True,
        "access_levels": ["ENFANT"],
    },
    {
        "kind": "DON",
        "name": "Don volontaire",
        "billing": "MENSUEL",
        "price_total": 0,
        "nb_tranches": 1,
        "tranche_amount": None,
        "description": "Soutien libre sans engagement ni accès supplémentaire.",
        "is_active": True,
        "access_levels": [],
    },
]


def seed_plans(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    for data in DEFAULT_PLANS:
        SubscriptionPlan.objects.update_or_create(
            kind=data["kind"],
            defaults={k: v for k, v in data.items() if k != "kind"},
        )


def unseed_plans(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    SubscriptionPlan.objects.filter(kind__in=[p["kind"] for p in DEFAULT_PLANS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0005_add_plan_kind_and_branches"),
    ]

    operations = [
        migrations.RunPython(seed_plans, unseed_plans),
    ]

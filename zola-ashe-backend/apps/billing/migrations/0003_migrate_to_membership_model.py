"""Conversion vers le modèle du livret : adhésion unique `MEMBRE`.

- Abonnements ANNUEL / BRANCHE_FEMME / BRANCHE_ENFANT → MEMBRE (un seul actif
  par membre ; les doublons sont désactivés).
- Paiements ADHESION / TRANCHE / BRANCHE → INSCRIPTION (COTISATION et
  REMBOURSEMENT inchangés).
"""
from django.db import migrations


def forwards(apps, schema_editor):
    Subscription = apps.get_model("billing", "Subscription")
    Payment = apps.get_model("billing", "Payment")

    # Abonnements → MEMBRE
    Subscription.objects.filter(
        type__in=["ANNUEL", "BRANCHE_FEMME", "BRANCHE_ENFANT"]
    ).update(type="MEMBRE")

    # Un seul abonnement MEMBRE actif par membre : garder le plus ancien.
    seen = set()
    for sub in Subscription.objects.filter(type="MEMBRE", active=True).order_by("user_id", "start", "id"):
        if sub.user_id in seen:
            sub.active = False
            sub.save(update_fields=["active"])
        else:
            seen.add(sub.user_id)

    # Paiements → INSCRIPTION
    Payment.objects.filter(type__in=["ADHESION", "TRANCHE", "BRANCHE"]).update(type="INSCRIPTION")


class Migration(migrations.Migration):
    dependencies = [("billing", "0002_alter_payment_type_alter_subscription_type")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]

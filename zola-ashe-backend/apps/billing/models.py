"""Abonnements, paiements et accès branches (CDC §6.1, §6.2, §6.6).

PAYMENTS est en append-only pour les paiements validés (RG-36) : jamais
d'UPDATE/DELETE — une erreur se corrige par un paiement REMBOURSEMENT négatif.
"""
from django.db import models


class SubscriptionType(models.TextChoices):
    # Modèle du livret : une seule adhésion. Le droit d'inscription la crée
    # (permanente) ; la cotisation mensuelle maintient l'accès actif.
    MEMBRE = "MEMBRE", "Membre"


class PaymentType(models.TextChoices):
    INSCRIPTION    = "INSCRIPTION",    "Droit d'inscription"
    COTISATION     = "COTISATION",     "Cotisation mensuelle"
    BRANCHE_FEMME  = "BRANCHE_FEMME",  "Accès espace Femme"
    BRANCHE_ENFANT = "BRANCHE_ENFANT", "Accès espace Enfant"
    DON            = "DON",            "Don volontaire"
    REMBOURSEMENT  = "REMBOURSEMENT",  "Remboursement"


class PaymentStatus(models.TextChoices):
    VALIDE = "VALIDE", "Validé"
    EN_ATTENTE = "EN_ATTENTE", "En attente"
    ECHOUE = "ECHOUE", "Échoué"


class Subscription(models.Model):
    """Adhésion d'un membre. L'adhésion est permanente (`active=True`) une fois le
    droit d'inscription réglé ; `end` porte l'**échéance d'accès** (date jusqu'à
    laquelle l'accès est payé). Chaque cotisation mensuelle prolonge `end` ; une
    fois `end` dépassée (+ délai de grâce), le cron rétrograde le membre RESTREINT."""
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="subscriptions")
    type = models.CharField(max_length=20, choices=SubscriptionType.choices)
    start = models.DateField()
    end = models.DateField(null=True, blank=True)  # échéance d'accès (paid_until) ; NULL = legacy permanent
    active = models.BooleanField(default=True)
    in_tranches = models.BooleanField(default=False)  # conservé (dormant) — compat. historique
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "subscriptions"
        indexes = [models.Index(fields=["user", "type", "active"])]


class Payment(models.Model):
    """Trace immuable d'un paiement (RG-36). `swinmo_ref` garantit l'idempotence (RG-08)."""
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="payments")
    subscription = models.ForeignKey(
        Subscription, on_delete=models.PROTECT, null=True, blank=True, related_name="payments")
    type = models.CharField(max_length=20, choices=PaymentType.choices)
    status = models.CharField(max_length=12, choices=PaymentStatus.choices)
    amount = models.IntegerField()  # FCFA ; négatif pour un remboursement
    swinmo_ref = models.CharField(max_length=128, unique=True, null=True, blank=True)
    reason = models.CharField(max_length=255, blank=True)  # ex. « Exonération admin » (RG-40)
    paid_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payments"
        indexes = [models.Index(fields=["user", "type", "status"])]


class SubscriptionPlan(models.Model):
    """Catalogue des offres d'abonnement/accès (tarifs, nombre de tranches, niveaux).
    Seeded via migration 0006. Permet de configurer les prix sans redéploiement."""

    class BillingCycle(models.TextChoices):
        ANNUEL   = "ANNUEL",   "Annuel (paiement unique)"
        TRANCHES = "TRANCHES", "En tranches mensuelles"
        MENSUEL  = "MENSUEL",  "Mensuel (renouvellement automatique)"

    kind           = models.CharField(max_length=20, choices=PaymentType.choices,
                                      unique=True, db_index=True)
    name           = models.CharField(max_length=200)
    billing        = models.CharField(max_length=10, choices=BillingCycle.choices)
    price_total    = models.IntegerField(default=0)
    nb_tranches    = models.PositiveIntegerField(default=1)
    tranche_amount = models.IntegerField(null=True, blank=True)
    description    = models.TextField(blank=True)
    is_active      = models.BooleanField(default=True)
    access_levels  = models.JSONField(default=list)   # ex. ["FEMME"]
    formation_ids  = models.JSONField(default=list)   # formations associées au plan
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "subscription_plans"
        ordering = ["billing", "name"]

    def __str__(self):
        return f"{self.name} ({self.kind})"

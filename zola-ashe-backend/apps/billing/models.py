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
    ANNUEL         = "ANNUEL",         "Cotisation annuelle"
    BRANCHE_FEMME  = "BRANCHE_FEMME",  "Accès espace Femme"
    BRANCHE_ENFANT = "BRANCHE_ENFANT", "Accès espace Enfant"
    DON            = "DON",            "Don volontaire"
    FORMATION      = "FORMATION",      "Achat d'une formation"
    LIVRE          = "LIVRE",          "Achat d'un livre"
    REMBOURSEMENT  = "REMBOURSEMENT",  "Remboursement"


class PaymentStatus(models.TextChoices):
    VALIDE = "VALIDE", "Validé"
    EN_ATTENTE = "EN_ATTENTE", "En attente"
    ECHOUE = "ECHOUE", "Échoué"
    # Payé chez Swinmo mais montant ou devise non conforme : aucun accès accordé,
    # à traiter par l'admin (alerte journalisée).
    AMOUNT_MISMATCH = "AMOUNT_MISMATCH", "Montant non conforme"


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
    """Trace immuable d'un paiement (RG-36). `swinmo_ref` garantit l'idempotence (RG-08).

    `swinmo_ref` porte NOTRE référence interne (UUID), créée avant l'appel à Swinmo ;
    `provider_tx_id` l'identifiant de commande Swinmo. `amount` est le montant attendu
    (calculé côté serveur), `paid_amount` celui confirmé par Swinmo à la vérification.
    `paid_at` est la date de création du paiement (historique) ; `verified_at` celle
    de la confirmation chez Swinmo.
    """
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="payments")
    subscription = models.ForeignKey(
        Subscription, on_delete=models.PROTECT, null=True, blank=True, related_name="payments")
    type = models.CharField(max_length=20, choices=PaymentType.choices)
    status = models.CharField(max_length=16, choices=PaymentStatus.choices)
    amount = models.IntegerField()  # montant attendu, FCFA ; négatif pour un remboursement
    currency = models.CharField(max_length=3, default="XAF")
    swinmo_ref = models.CharField(max_length=128, unique=True, null=True, blank=True)
    provider_tx_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    paid_amount = models.IntegerField(null=True, blank=True)   # montant confirmé par Swinmo
    verified_at = models.DateTimeField(null=True, blank=True)
    coupon_code = models.CharField(max_length=64, blank=True, default="")  # réservé (pas de coupons)
    # Relances d'un paiement abandonné ou échoué (job remind_unpaid_payments).
    reminder_count = models.PositiveSmallIntegerField(default=0)
    last_reminder_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=255, blank=True)  # ex. « Exonération admin » (RG-40)
    # Formation achetée (type=FORMATION uniquement).
    formation = models.ForeignKey(
        "content.Formation", on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    # Livre (PDF de la bibliothèque) acheté (type=LIVRE uniquement).
    library_pdf = models.ForeignKey(
        "content.LibraryPdf", on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    paid_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payments"
        indexes = [models.Index(fields=["user", "type", "status"])]

    @property
    def expected_amount(self) -> int:
        return self.amount


class FormationPurchase(models.Model):
    """Accès permanent à une formation achetée à l'unité, sans abonnement."""
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="formation_purchases")
    formation = models.ForeignKey("content.Formation", on_delete=models.CASCADE, related_name="purchases")
    payment = models.ForeignKey(Payment, on_delete=models.SET_NULL, null=True, blank=True,
                                related_name="formation_purchases")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "formation_purchases"
        constraints = [models.UniqueConstraint(fields=["user", "formation"],
                                               name="uniq_formation_purchase")]


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


class LibraryPdfPurchase(models.Model):
    """Accès permanent à un livre (PDF de la bibliothèque) acheté à l'unité."""
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="library_purchases")
    library_pdf = models.ForeignKey("content.LibraryPdf", on_delete=models.CASCADE, related_name="purchases")
    payment = models.ForeignKey(Payment, on_delete=models.SET_NULL, null=True, blank=True,
                                related_name="library_purchases")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "library_pdf_purchases"
        constraints = [models.UniqueConstraint(fields=["user", "library_pdf"],
                                               name="uniq_library_pdf_purchase")]

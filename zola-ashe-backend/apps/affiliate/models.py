"""Système de parrainage / affiliation (RG-AF).

Un membre partage son lien d'invitation (code unique). Quand le filleul
s'inscrit avec ce code ET souscrit à un abonnement, le parrain gagne une
commission. Une fois le seuil minimum atteint, il peut demander un retrait
via WhatsApp.
"""
from django.db import models
from django.utils import timezone


class AffiliateConfig(models.Model):
    """Config singleton du programme de parrainage (toujours pk=1)."""
    commission_amount = models.PositiveIntegerField(
        default=2000,
        help_text="Commission versée au parrain par filleul validé (FCFA).")
    min_withdrawal = models.PositiveIntegerField(
        default=5000,
        help_text="Solde minimum pour demander un retrait (FCFA).")
    whatsapp_number = models.CharField(
        max_length=30, blank=True, default="",
        help_text="Numéro WhatsApp admin (ex: +237600000000) pour les retraits.")
    is_active = models.BooleanField(
        default=True,
        help_text="Activer/désactiver le programme d'affiliation.")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "affiliate_config"
        verbose_name = "Configuration affiliation"

    @classmethod
    def get(cls) -> "AffiliateConfig":
        obj, _ = cls.objects.get_or_create(pk=1, defaults={})
        return obj

    def __str__(self):
        return f"AffiliateConfig (commission={self.commission_amount} FCFA, min={self.min_withdrawal} FCFA)"


class ReferralStatus(models.TextChoices):
    PENDING   = "PENDING",   "En attente (filleul non abonné)"
    VALIDATED = "VALIDATED", "Validé (commission due)"
    PAID      = "PAID",      "Payé"


class Referral(models.Model):
    """Parrainage : referrer → referred.

    Cycle : PENDING (inscription sans abonnement) → VALIDATED (premier abonnement
    souscrit) → PAID (commission versée par l'admin).
    """
    referrer = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE,
        related_name="referrals_given",
        verbose_name="Parrain")
    referred = models.OneToOneField(
        "accounts.User", on_delete=models.CASCADE,
        related_name="referral_from", null=True, blank=True,
        verbose_name="Filleul")
    commission = models.PositiveIntegerField(
        default=0,
        help_text="Commission en FCFA (0 tant que PENDING, fixée à la validation).")
    status = models.CharField(
        max_length=12, choices=ReferralStatus.choices,
        default=ReferralStatus.PENDING, db_index=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    validated_at = models.DateTimeField(null=True, blank=True)
    paid_at      = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "referrals"
        indexes = [models.Index(fields=["referrer", "status"])]
        verbose_name = "Parrainage"

    def __str__(self):
        return f"Referral #{self.id} ({self.referrer_id} → {self.referred_id}) [{self.status}]"

"""Serializers billing : abonnements, paiements, initiation."""
from rest_framework import serializers

from .models import Payment, Subscription

PURCHASE_KINDS = ("INSCRIPTION", "COTISATION", "ANNUEL", "DON",
                   "BRANCHE_FEMME", "BRANCHE_ENFANT", "FORMATION", "LIVRE")


class SubscriptionSerializer(serializers.ModelSerializer):
    days_remaining = serializers.SerializerMethodField(
        help_text="Jours restants avant l'échéance d'accès (0 si échue).")
    is_current = serializers.SerializerMethodField(
        help_text="True si l'accès est encore couvert (échéance non dépassée).")

    class Meta:
        model = Subscription
        fields = ("id", "type", "start", "end", "active", "in_tranches",
                  "days_remaining", "is_current", "created_at")
        read_only_fields = fields

    def get_days_remaining(self, obj) -> int:
        from django.utils import timezone
        if not obj.end:
            return 0
        return max(0, (obj.end - timezone.now().date()).days)

    def get_is_current(self, obj) -> bool:
        from django.utils import timezone
        return bool(obj.end and obj.end >= timezone.now().date())


class PaymentSerializer(serializers.ModelSerializer):
    formation_title = serializers.CharField(source="formation.title", read_only=True, default=None)
    library_pdf_title = serializers.CharField(source="library_pdf.title", read_only=True, default=None)

    class Meta:
        model = Payment
        fields = ("id", "type", "status", "amount", "swinmo_ref", "reason",
                  "subscription", "formation", "formation_title",
                  "library_pdf", "library_pdf_title", "paid_at")
        read_only_fields = fields


class InitiatePaymentSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=PURCHASE_KINDS)
    amount = serializers.IntegerField(required=False, min_value=1)  # don : montant libre
    formation_id = serializers.IntegerField(required=False)          # achat d'une formation
    library_pdf_id = serializers.IntegerField(required=False)        # achat d'un livre

    def validate(self, attrs):
        from django.conf import settings
        from apps.accounts.features import monthly_subscription_enabled
        if attrs["kind"] == "COTISATION" and not monthly_subscription_enabled():
            raise serializers.ValidationError(
                {"kind": "La cotisation mensuelle est désactivée : aucun paiement mensuel n'est requis."})
        if attrs["kind"] == "FORMATION":
            attrs["formation"] = self._purchasable_formation(attrs.get("formation_id"))
        if attrs["kind"] == "LIVRE":
            attrs["library_pdf"] = self._purchasable_library_pdf(attrs.get("library_pdf_id"))
        if attrs["kind"] == "DON":
            amount = attrs.get("amount")
            if not amount or amount < settings.DON_MIN_AMOUNT:
                raise serializers.ValidationError(
                    {"amount": f"Un don doit être d'au moins {settings.DON_MIN_AMOUNT} FCFA."})
        return attrs

    def _purchasable_formation(self, formation_id):
        from apps.content.services import formation_accessible, visible_formations_qs
        if not formation_id:
            raise serializers.ValidationError({"formation_id": "Formation requise."})
        formation = visible_formations_qs().filter(pk=formation_id).first()
        if formation is None:
            raise serializers.ValidationError({"formation_id": "Formation introuvable."})
        if not formation.price:
            raise serializers.ValidationError(
                {"formation_id": "Cette formation n'est pas proposée à l'achat."})
        if formation_accessible(self.context["request"].user, formation):
            raise serializers.ValidationError({"formation_id": "Vous avez déjà accès à cette formation."})
        return formation

    def _purchasable_library_pdf(self, pdf_id):
        from apps.content.models import LibraryPdf
        from apps.content.services import library_pdf_accessible
        if not pdf_id:
            raise serializers.ValidationError({"library_pdf_id": "Livre requis."})
        pdf = LibraryPdf.objects.filter(pk=pdf_id, is_active=True).first()
        if pdf is None:
            raise serializers.ValidationError({"library_pdf_id": "Livre introuvable."})
        if not pdf.price:
            raise serializers.ValidationError({"library_pdf_id": "Ce livre n'est pas proposé à l'achat."})
        if library_pdf_accessible(self.context["request"].user, pdf):
            raise serializers.ValidationError({"library_pdf_id": "Vous avez déjà accès à ce livre."})
        return pdf

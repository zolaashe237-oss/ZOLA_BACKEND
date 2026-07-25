"""Serializers billing : abonnements, paiements, initiation."""
from rest_framework import serializers

from .models import Payment, Subscription

PURCHASE_KINDS = ("INSCRIPTION", "COTISATION", "DON")


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
    class Meta:
        model = Payment
        fields = ("id", "type", "status", "amount", "swinmo_ref", "reason",
                  "subscription", "paid_at")
        read_only_fields = fields


class InitiatePaymentSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=PURCHASE_KINDS)
    amount = serializers.IntegerField(required=False, min_value=1)  # don : montant libre

    def validate(self, attrs):
        from django.conf import settings
        if attrs["kind"] == "DON":
            amount = attrs.get("amount")
            if not amount or amount < settings.DON_MIN_AMOUNT:
                raise serializers.ValidationError(
                    {"amount": f"Un don doit être d'au moins {settings.DON_MIN_AMOUNT} FCFA."})
        return attrs

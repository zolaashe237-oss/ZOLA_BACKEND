"""Vues billing : tarifs publics, initiation de paiement, historique, webhook Swinmo."""
import json

from django.conf import settings
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import generics, serializers as drf_serializers, status, viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import swinmo
from .models import Payment, Subscription
from .serializers import (
    InitiatePaymentSerializer,
    PaymentSerializer,
    SubscriptionSerializer,
)
from .services import (
    close_subscription,
    confirm_mock_payment,
    initiate_payment,
    process_webhook_event,
)

_TariffList = inline_serializer(
    name="TariffList", many=True,
    fields={"kind": drf_serializers.CharField(), "label": drf_serializers.CharField(),
            "amount": drf_serializers.IntegerField(help_text="Montant en FCFA (0 = libre, ex. don).")})
_InitiateResponse = inline_serializer(
    name="InitiatePaymentResponse",
    fields={"checkout_url": drf_serializers.CharField(help_text="URL de paiement (Swinmo ou page de simulation en mode mock)."),
            "reference": drf_serializers.CharField(),
            "amount": drf_serializers.IntegerField(),
            "mock": drf_serializers.BooleanField(required=False, help_text="True si paiement simulé (mode démo).")})
_MockConfirmRequest = inline_serializer(
    name="MockConfirmRequest", fields={"reference": drf_serializers.CharField()})
_MockConfirmResponse = inline_serializer(
    name="MockConfirmResponse",
    fields={"confirmed": drf_serializers.BooleanField(), "kind": drf_serializers.CharField()})
_WebhookRequest = inline_serializer(
    name="SwinmoWebhookRequest",
    fields={"event": drf_serializers.CharField(), "data": drf_serializers.DictField()})
_CloseRequest = inline_serializer(
    name="CloseSubscriptionRequest",
    fields={"reason": drf_serializers.CharField(required=False, allow_blank=True,
                                                help_text="Motif facultatif de la clôture.")})
_CloseResponse = inline_serializer(
    name="CloseSubscriptionResponse",
    fields={"closed": drf_serializers.BooleanField(),
            "end": drf_serializers.DateField(help_text="Échéance figée (aujourd'hui)."),
            "status": drf_serializers.CharField(help_text="Nouveau statut du membre (RESTREINT).")})


@extend_schema(
    tags=["Paiements & adhésion"],
    summary="Tarifs publics",
    description="Liste les tarifs affichables sur la vitrine (droit d'inscription, cotisation, don). "
                "Aucun secret n'est exposé. Accès libre.",
    responses={200: OpenApiResponse(_TariffList, description="Tarifs courants.")},
)
class SubscriptionTypesView(APIView):
    """Tarifs publics (vitrine) — lus en DB (SubscriptionPlan), aucun secret exposé."""
    permission_classes = [AllowAny]

    _KINDS = ["INSCRIPTION", "COTISATION", "DON", "BRANCHE_FEMME", "BRANCHE_ENFANT"]

    def get(self, _request):
        from .models import SubscriptionPlan
        db_plans = {p.kind: p for p in SubscriptionPlan.objects.filter(is_active=True)}
        result = []
        for kind in self._KINDS:
            p = db_plans.get(kind)
            if p:
                result.append({
                    "kind":           kind,
                    "label":          p.name,
                    "amount":         p.tranche_amount if p.tranche_amount is not None else p.price_total,
                    "price_total":    p.price_total,
                    "tranche_amount": p.tranche_amount,
                    "nb_tranches":    p.nb_tranches,
                    "billing":        p.billing,
                })
        return Response(result)


@extend_schema(
    tags=["Paiements & adhésion"],
    summary="Initier un paiement",
    description=(
        "Crée un paiement en attente et renvoie une URL de paiement.\n\n"
        "En mode réel, l'URL pointe vers **Swinmo**. En mode démo (`SWINMO_MOCK`), elle pointe vers "
        "la page de simulation interne et `mock=true` ; le paiement se confirme ensuite via "
        "`POST /billing/payments/mock-confirm/`.\n\n`kind` ∈ {INSCRIPTION, COTISATION, DON}. "
        "Pour un don, `amount` est requis.\n\n"
        "**Durée d'accès** : l'inscription ouvre l'adhésion et inclut une **1ʳᵉ période** de 30 jours ; "
        "chaque **cotisation mensuelle** prolonge l'échéance de 30 jours, de façon **cumulable** "
        "(payer en avance ajoute du temps). Passé l'échéance + délai de grâce, le membre devient RESTREINT."
    ),
    examples=[
        OpenApiExample("Droit d'inscription", request_only=True, value={"kind": "INSCRIPTION"}),
        OpenApiExample("Cotisation mensuelle", request_only=True, value={"kind": "COTISATION"}),
        OpenApiExample("Don libre", request_only=True, value={"kind": "DON", "amount": 10000}),
        OpenApiExample("Réponse (mode démo)", response_only=True, value={
            "payment_id": 42, "reference": "9f2c…", "amount": 5000, "mock": True,
            "checkout_url": "http://localhost:3002/paiement/simulation?ref=9f2c…&kind=INSCRIPTION&amount=5000"}),
    ],
    responses={201: OpenApiResponse(_InitiateResponse, description="Paiement initié."),
               502: OpenApiResponse(description="Service de paiement indisponible.")},
)
class InitiatePaymentView(generics.GenericAPIView):
    """Crée un lien de paiement Swinmo pour le membre connecté."""
    permission_classes = [IsAuthenticated]
    serializer_class = InitiatePaymentSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = initiate_payment(request.user, data["kind"], data.get("amount"))
        except swinmo.SwinmoError as exc:
            return Response({"detail": f"Service de paiement indisponible. Réessayez plus tard. {exc}"},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response(result, status=status.HTTP_201_CREATED)


@extend_schema(
    tags=["Paiements & adhésion"],
    summary="Confirmer un paiement simulé (démo)",
    description="Confirme un paiement en attente **en mode démo uniquement** (sans Swinmo), pour le "
                "membre connecté. Active l'adhésion/cotisation correspondante. La `reference` est celle "
                "renvoyée par l'initiation.",
    request=_MockConfirmRequest,
    examples=[OpenApiExample("Confirmer", request_only=True, value={"reference": "9f2c…"}),
              OpenApiExample("Confirmé", response_only=True, value={"confirmed": True, "kind": "INSCRIPTION"})],
    responses={200: OpenApiResponse(_MockConfirmResponse, description="Paiement confirmé."),
               400: OpenApiResponse(description="Référence inconnue ou déjà traitée.")},
)
class MockConfirmView(APIView):
    """Confirme un paiement simulé (mode MOCK, sans Swinmo). Réservé au membre
    connecté pour son propre paiement en attente."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        reference = request.data.get("reference", "")
        try:
            kind = confirm_mock_payment(request.user, reference)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"confirmed": True, "kind": kind})


@extend_schema_view(
    list=extend_schema(tags=["Paiements & adhésion"], summary="Mes paiements",
                       description="Historique des paiements du membre connecté (anti-chronologique)."),
    retrieve=extend_schema(tags=["Paiements & adhésion"], summary="Détail d'un de mes paiements"),
)
class MyPaymentsViewSet(viewsets.ReadOnlyModelViewSet):
    """Historique des paiements du membre connecté."""
    serializer_class = PaymentSerializer
    permission_classes = [IsAuthenticated]
    queryset = Payment.objects.none()  # repli pour l'introspection du type de `id` (schéma)

    def get_queryset(self):
        return Payment.objects.filter(user=self.request.user).order_by("-paid_at")


@extend_schema(
    tags=["Paiements & adhésion"],
    summary="Mes abonnements",
    description="Abonnements du membre connecté. Chaque entrée expose l'**échéance d'accès** (`end`), "
                "les **jours restants** (`days_remaining`) et `is_current` (accès encore couvert).",
)
class MySubscriptionsView(generics.ListAPIView):
    """Abonnements du membre connecté."""
    serializer_class = SubscriptionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Subscription.objects.filter(user=self.request.user).order_by("-created_at")


@extend_schema(
    tags=["Paiements & adhésion"],
    summary="Clôturer mon adhésion",
    description="Résiliation **volontaire et immédiate** de l'adhésion du membre connecté : "
                "l'adhésion est désactivée, l'échéance figée à aujourd'hui, et le membre repasse "
                "`RESTREINT`. Les jours déjà réglés ne sont pas remboursés. Une nouvelle inscription "
                "rouvre une adhésion. Action journalisée à l'audit.",
    request=_CloseRequest,
    responses={200: OpenApiResponse(_CloseResponse, description="Adhésion clôturée."),
               400: OpenApiResponse(description="Aucune adhésion active à clôturer.")},
)
class CloseSubscriptionView(APIView):
    """Clôture volontaire de l'adhésion (résiliation immédiate) par le membre."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            sub = close_subscription(request.user, reason=request.data.get("reason", ""))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"closed": True, "end": sub.end, "status": request.user.status})


@extend_schema(
    tags=["Paiements & adhésion"],
    summary="Webhook Swinmo",
    description=(
        "Endpoint appelé par **Swinmo** lors d'un événement de paiement (RG-08). "
        "Authentifié par **signature HMAC** (en-tête `x-swinmo-signature`), pas par JWT. "
        "Répond toujours 200 si la signature est valide, pour éviter les re-livraisons."
    ),
    request=_WebhookRequest,
    responses={200: OpenApiResponse(description="Événement reçu."),
               401: OpenApiResponse(description="Signature invalide.")},
)
class SwinmoWebhookView(APIView):
    """Webhook Swinmo (RG-08). Authentifié par signature HMAC, pas par JWT."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def post(self, request):
        signature = request.headers.get("x-swinmo-signature")
        if not swinmo.verify_signature(request.body, signature):
            return Response({"detail": "Signature invalide."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            body = json.loads(request.body or b"{}")
        except json.JSONDecodeError:
            return Response({"detail": "Corps invalide."}, status=status.HTTP_400_BAD_REQUEST)

        event = body.get("event", "")
        data = body.get("data") or {}
        outcome = process_webhook_event(event, data)
        # Toujours 200 si la signature est valide → évite les re-livraisons inutiles.
        return Response({"received": True, "outcome": outcome})

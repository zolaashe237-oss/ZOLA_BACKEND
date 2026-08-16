"""Vues WhatsApp admin — templates, envoi de messages (avec/sans template)."""
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.notifications.models import WhatsAppTemplate
from apps.notifications.whatsapp import WhatsAppService

from .permissions import IsAdmin
from .serializers import (
    SendWhatsAppMessageSerializer,
    WhatsAppTemplateSerializer,
)

# ─── CRUD Templates WhatsApp ─────────────────────────────────────────────────

class WhatsAppTemplateListCreateView(generics.ListCreateAPIView):
    """
    GET /api/admin/whatsapp/templates/ → Liste tous les templates
    POST /api/admin/whatsapp/templates/ → Crée un nouveau template
    """
    queryset = WhatsAppTemplate.objects.all()
    serializer_class = WhatsAppTemplateSerializer
    permission_classes = [IsAuthenticated, IsAdmin]

    @extend_schema(summary="Liste des templates WhatsApp")
    def get(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(summary="Création d'un template WhatsApp")
    def post(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)


class WhatsAppTemplateDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/admin/whatsapp/templates/<id>/ → Détail d'un template
    PUT /api/admin/whatsapp/templates/<id>/ → Mise à jour complète
    PATCH /api/admin/whatsapp/templates/<id>/ → Mise à jour partielle
    DELETE /api/admin/whatsapp/templates/<id>/ → Suppression
    """
    queryset = WhatsAppTemplate.objects.all()
    serializer_class = WhatsAppTemplateSerializer
    permission_classes = [IsAuthenticated, IsAdmin]

    @extend_schema(summary="Détail d'un template WhatsApp")
    def get(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(summary="Mise à jour d'un template WhatsApp")
    def put(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @extend_schema(summary="Mise à jour partielle d'un template WhatsApp")
    def patch(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(summary="Suppression d'un template WhatsApp")
    def delete(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)


# ─── Envoi de message WhatsApp ───────────────────────────────────────────────

class SendWhatsAppMessageView(generics.CreateAPIView):
    """
    POST /api/admin/whatsapp/send/

    Envoie un message WhatsApp.

    Deux modes :
    - **Sans template** (`message` uniquement) : pour répondre à une conversation
      initiée par le client (fenêtre de 24h).
    - **Avec template** (`template_slug` + `variables` optionnelles) : pour initier
      une conversation depuis le business (obligatoire Twilio).

    Paramètres :
    - `phone_number` (obligatoire) : numéro du destinataire
    - `message` : texte libre (mode sans template)
    - `template_slug` : slug du template prédéfini (mode avec template)
    - `variables` : dict des variables à substituer (ex: {"1": "Jean", "2": "5000"})
    - `provider` : force un provider (MOCK, TWILIO, EVOLUTION_API, META) — défaut = settings
    """
    serializer_class = SendWhatsAppMessageSerializer
    permission_classes = [IsAuthenticated, IsAdmin]

    @extend_schema(summary="Envoi d'un message WhatsApp (avec ou sans template)")
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        phone_number = data["phone_number"]
        provider = data.get("provider") or None  # None = provider par défaut

        service = WhatsAppService(provider=provider)

        if data.get("template_slug"):
            success = service.send_template_message(
                phone_number=phone_number,
                template_slug=data["template_slug"],
                variables=data.get("variables") or {},
            )
        else:
            success = service.send_message(
                phone_number=phone_number,
                message=data["message"],
            )

        if success:
            return Response(
                {"success": True, "message": "Message WhatsApp envoyé avec succès."},
                status=status.HTTP_200_OK,
            )
        return Response(
            {"success": False, "message": "Échec de l'envoi du message WhatsApp."},
            status=status.HTTP_502_BAD_GATEWAY,
        )

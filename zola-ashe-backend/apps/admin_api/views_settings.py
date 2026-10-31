import re

from django.db import transaction
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from apps.accounts.features import MEMBER_SECTIONS
from apps.accounts.models import GlobalSettings
from apps.audit.models import AuditAction
from apps.audit.services import record

from .permissions import IsAdmin


class GlobalSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalSettings
        fields = ['admin_whatsapp', 'facebook_url', 'twitter_url', 'instagram_url', 'youtube_url', 'updated_at']


class AdminGlobalSettingsView(generics.RetrieveUpdateAPIView):
    """
    GET / PUT / PATCH pour les paramètres globaux (admin_whatsapp, réseaux sociaux).
    """
    permission_classes = [IsAdmin]
    serializer_class = GlobalSettingsSerializer

    @extend_schema(summary="Obtenir les paramètres globaux")
    def get_object(self):
        return GlobalSettings.load()


class FeatureSettingsSerializer(serializers.ModelSerializer):
    hidden_sections = serializers.ListField(
        child=serializers.ChoiceField(choices=list(MEMBER_SECTIONS)), required=False)

    class Meta:
        model = GlobalSettings
        fields = ['quiz_enabled', 'monthly_subscription_enabled', 'hidden_sections', 'updated_at']
        read_only_fields = ['updated_at']

    def validate_hidden_sections(self, value):
        return sorted(set(value))


AI_BILLING_URLS = {
    "gemini": "https://console.cloud.google.com/billing",
    "openai": "https://platform.openai.com/settings/organization/billing",
    "anthropic": "https://console.anthropic.com/settings/billing",
}
AI_PROVIDER_LABELS = {"gemini": "Google Gemini", "openai": "OpenAI", "anthropic": "Anthropic"}

# Messages d'erreur des fournisseurs signalant des crédits / un quota épuisés.
_QUOTA_ERROR = re.compile(
    r"quota|resource[_ ]exhausted|insufficient|credit|billing|rate.?limit|\b429\b|exceeded", re.I)


def ai_credits_status() -> dict:
    """Fournisseur IA des quiz et dernier épuisement de crédits détecté.

    Les fournisseurs n'exposent pas de solde lisible avec une clé API : on se fonde
    sur le dernier job de génération en échec pour quota, s'il n'a pas été suivi
    d'une génération réussie.
    """
    from django.conf import settings
    from apps.ai_quiz.models import AIQuizJob, JobStatus

    provider = (settings.AI_PROVIDER or "").lower().strip()
    status = {
        "provider": provider,
        "provider_label": AI_PROVIDER_LABELS.get(provider, provider or "—"),
        "billing_url": AI_BILLING_URLS.get(provider),
        "enabled": bool(getattr(settings, "AI_ENABLED", True)),
        "quota_error_at": None,
        "quota_error": "",
    }
    last_failed = (AIQuizJob.objects.filter(status=JobStatus.FAILED)
                   .exclude(error_message="").order_by("-created_at").first())
    if last_failed and _QUOTA_ERROR.search(last_failed.error_message):
        succeeded_since = AIQuizJob.objects.filter(
            status=JobStatus.DONE, created_at__gt=last_failed.created_at).exists()
        if not succeeded_since:
            status["quota_error_at"] = last_failed.created_at
            status["quota_error"] = last_failed.error_message[:300]
    return status


class AdminFeatureSettingsView(APIView):
    """Interrupteurs de fonctionnalités : quiz, cotisation mensuelle, sections de l'espace membre.

    Désactiver la cotisation réactive les membres restreints pour échéance dépassée ;
    la réactiver repousse les échéances dépassées de quelques jours (voir billing.services).
    """
    permission_classes = [IsAdmin]

    def _payload(self, obj, **extra):
        data = FeatureSettingsSerializer(obj).data
        data["available_sections"] = [{"key": k, "label": v[0]} for k, v in MEMBER_SECTIONS.items()]
        data["ai_credits"] = ai_credits_status()
        data.update(extra)
        return data

    @extend_schema(summary="Lire les interrupteurs de fonctionnalités")
    def get(self, request):
        return Response(self._payload(GlobalSettings.load()))

    @extend_schema(summary="Modifier les interrupteurs de fonctionnalités", request=FeatureSettingsSerializer)
    def patch(self, request):
        from apps.billing.services import resume_monthly_requirement, suspend_monthly_requirement

        obj = GlobalSettings.load()
        before = FeatureSettingsSerializer(obj).data
        serializer = FeatureSettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        monthly_before = obj.monthly_subscription_enabled
        side_effects = {}
        with transaction.atomic():
            obj = serializer.save()
            if monthly_before and not obj.monthly_subscription_enabled:
                side_effects["members_reactivated"] = suspend_monthly_requirement()
            elif not monthly_before and obj.monthly_subscription_enabled:
                side_effects["subscriptions_extended"] = resume_monthly_requirement()

        after = FeatureSettingsSerializer(obj).data
        changes = {k: {"before": before[k], "after": after[k]}
                   for k in ("quiz_enabled", "monthly_subscription_enabled", "hidden_sections")
                   if before[k] != after[k]}
        if changes:
            record(request.user, AuditAction.UPDATE_SETTINGS, target_type="GlobalSettings",
                   target_id=1, reason="Interrupteurs de fonctionnalités",
                   payload={"changes": changes, **side_effects})
        return Response(self._payload(obj, **side_effects))

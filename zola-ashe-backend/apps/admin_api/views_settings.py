from rest_framework import generics, serializers
from rest_framework.permissions import IsAuthenticated
from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.accounts.models import GlobalSettings


class GlobalSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalSettings
        fields = ['admin_whatsapp', 'facebook_url', 'twitter_url', 'instagram_url', 'youtube_url', 'updated_at']


class AdminGlobalSettingsView(generics.RetrieveUpdateAPIView):
    """
    GET / PUT / PATCH pour les paramètres globaux (admin_whatsapp, réseaux sociaux).
    """
    permission_classes = [IsAuthenticated]
    serializer_class = GlobalSettingsSerializer

    @extend_schema(summary="Obtenir les paramètres globaux")
    def get_object(self):
        return GlobalSettings.load()

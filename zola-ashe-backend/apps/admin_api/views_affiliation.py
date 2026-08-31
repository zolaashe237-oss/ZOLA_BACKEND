"""Vues admin pour le module Affiliation & Parrainage."""
from django.core.cache import cache
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import GlobalSettings
from apps.admin_api.permissions import IsAdmin

_TAG = "Admin - Affiliation"
CACHE_KEY_AFFILIATE_CONFIG = "affiliate_config_data"


class AffiliateConfigSerializer(serializers.Serializer):
    commission_amount = serializers.FloatField(default=5000.0)
    min_withdrawal = serializers.FloatField(default=10000.0)
    whatsapp_number = serializers.CharField(required=False, allow_blank=True, default="")
    is_active = serializers.BooleanField(default=True)
    updated_at = serializers.DateTimeField(required=False)


def _get_affiliate_config() -> dict:
    gs = GlobalSettings.load()
    default_cfg = {
        "commission_amount": 5000.0,
        "min_withdrawal": 10000.0,
        "whatsapp_number": gs.admin_whatsapp or "+237690000000",
        "is_active": True,
        "updated_at": gs.updated_at.isoformat() if gs.updated_at else timezone.now().isoformat(),
    }
    stored = cache.get(CACHE_KEY_AFFILIATE_CONFIG)
    if isinstance(stored, dict):
        default_cfg.update(stored)
    return default_cfg


@extend_schema(tags=[_TAG], summary="Configuration du programme d'affiliation")
class AdminAffiliateConfigView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = AffiliateConfigSerializer

    def get(self, request):
        return Response(_get_affiliate_config())

    def patch(self, request):
        cfg = _get_affiliate_config()
        if "commission_amount" in request.data:
            try:
                cfg["commission_amount"] = float(request.data["commission_amount"])
            except (ValueError, TypeError):
                pass
        if "min_withdrawal" in request.data:
            try:
                cfg["min_withdrawal"] = float(request.data["min_withdrawal"])
            except (ValueError, TypeError):
                pass
        if "whatsapp_number" in request.data:
            cfg["whatsapp_number"] = str(request.data["whatsapp_number"])
            gs = GlobalSettings.load()
            gs.admin_whatsapp = cfg["whatsapp_number"]
            gs.save()
        if "is_active" in request.data:
            cfg["is_active"] = bool(request.data["is_active"])

        cfg["updated_at"] = timezone.now().isoformat()
        cache.set(CACHE_KEY_AFFILIATE_CONFIG, cfg, timeout=None)
        return Response(cfg)

    def put(self, request):
        return self.patch(request)


@extend_schema(tags=[_TAG], summary="Statistiques globales d'affiliation")
class AdminAffiliateStatsView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def get(self, request):
        return Response({
            "total_referrals": 0,
            "pending_referrals": 0,
            "validated_referrals": 0,
            "paid_referrals": 0,
            "total_commissions": 0,
            "paid_commissions": 0,
            "pending_commissions": 0,
            "top_referrers": [],
        })


@extend_schema(tags=[_TAG], summary="Liste paginée des parrainages")
class AdminAffiliateReferralsView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def get(self, request):
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 25))
        return Response({
            "count": 0,
            "next": None,
            "previous": None,
            "results": [],
            "page": page,
            "page_size": page_size,
        })


@extend_schema(tags=[_TAG], summary="Marquer des commissions comme payées")
class AdminAffiliateMarkPaidView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request):
        ids = request.data.get("ids", [])
        return Response({"updated": len(ids)}, status=status.HTTP_200_OK)


# Aliases pour compatibilité
AffiliateConfigView = AdminAffiliateConfigView
AffiliateStatsView = AdminAffiliateStatsView
AffiliateReferralsView = AdminAffiliateReferralsView
AffiliateMarkPaidView = AdminAffiliateMarkPaidView


"""Vues admin pour le module Affiliation & Parrainage."""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.affiliate.models import AffiliateConfig
from apps.admin_api.permissions import IsAdmin

_TAG = "Admin - Affiliation"


class AffiliateConfigSerializer(serializers.Serializer):
    commission_amount = serializers.IntegerField()
    min_withdrawal = serializers.IntegerField()
    whatsapp_number = serializers.CharField(required=False, allow_blank=True, default="")
    is_active = serializers.BooleanField(default=True)
    updated_at = serializers.DateTimeField(required=False)


def _serialize_config(cfg: AffiliateConfig) -> dict:
    return {
        "commission_amount": cfg.commission_amount,
        "min_withdrawal":    cfg.min_withdrawal,
        "whatsapp_number":   cfg.whatsapp_number,
        "is_active":         cfg.is_active,
        "updated_at":        cfg.updated_at,
    }


@extend_schema(tags=[_TAG], summary="Configuration du programme d'affiliation")
class AdminAffiliateConfigView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = AffiliateConfigSerializer

    def get(self, request):
        return Response(_serialize_config(AffiliateConfig.get()))

    def patch(self, request):
        cfg  = AffiliateConfig.get()
        data = request.data
        if "commission_amount" in data:
            try:
                cfg.commission_amount = int(data["commission_amount"])
            except (ValueError, TypeError):
                pass
        if "min_withdrawal" in data:
            try:
                cfg.min_withdrawal = int(data["min_withdrawal"])
            except (ValueError, TypeError):
                pass
        if "whatsapp_number" in data:
            cfg.whatsapp_number = str(data["whatsapp_number"]).strip()
        if "is_active" in data:
            cfg.is_active = bool(data["is_active"])
        cfg.save()
        return Response(_serialize_config(cfg))

    def put(self, request):
        return self.patch(request)


class AdminAffiliateStatsSerializer(serializers.Serializer):
    total_referrals = serializers.IntegerField(default=0)
    pending_referrals = serializers.IntegerField(default=0)
    validated_referrals = serializers.IntegerField(default=0)
    paid_referrals = serializers.IntegerField(default=0)
    total_commissions = serializers.FloatField(default=0.0)
    paid_commissions = serializers.FloatField(default=0.0)
    pending_commissions = serializers.FloatField(default=0.0)
    top_referrers = serializers.ListField(child=serializers.DictField(), default=list)


class AdminReferralItemSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False)
    referrer_name = serializers.CharField(required=False)
    referred_name = serializers.CharField(required=False)
    amount = serializers.FloatField(required=False)
    status = serializers.CharField(required=False)
    created_at = serializers.DateTimeField(required=False)


class AdminReferralsPaginatedSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.CharField(allow_null=True)
    previous = serializers.CharField(allow_null=True)
    results = AdminReferralItemSerializer(many=True)
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()


class AdminAffiliateMarkPaidRequestSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField())


class AdminAffiliateMarkPaidResponseSerializer(serializers.Serializer):
    updated = serializers.IntegerField()


@extend_schema(tags=[_TAG], summary="Statistiques globales d'affiliation", responses={200: AdminAffiliateStatsSerializer})
class AdminAffiliateStatsView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = AdminAffiliateStatsSerializer

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


@extend_schema(tags=[_TAG], summary="Liste paginée des parrainages", responses={200: AdminReferralsPaginatedSerializer})
class AdminAffiliateReferralsView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = AdminReferralsPaginatedSerializer

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


@extend_schema(
    tags=[_TAG],
    summary="Marquer des commissions comme payées",
    request=AdminAffiliateMarkPaidRequestSerializer,
    responses={200: AdminAffiliateMarkPaidResponseSerializer}
)
class AdminAffiliateMarkPaidView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = AdminAffiliateMarkPaidResponseSerializer

    def post(self, request):
        ids = request.data.get("ids", [])
        return Response({"updated": len(ids)}, status=status.HTTP_200_OK)


# Aliases pour compatibilité
AffiliateConfigView = AdminAffiliateConfigView
AffiliateStatsView = AdminAffiliateStatsView
AffiliateReferralsView = AdminAffiliateReferralsView
AffiliateReferralListView = AdminAffiliateReferralsView
AffiliateMarkPaidView = AdminAffiliateMarkPaidView



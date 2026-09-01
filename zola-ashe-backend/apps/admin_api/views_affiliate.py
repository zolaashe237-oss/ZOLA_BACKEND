"""Back-office — gestion du programme de parrainage / affiliation."""
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.affiliate.models import AffiliateConfig, Referral, ReferralStatus
from apps.audit.models import AuditAction
from apps.audit.services import record

from .permissions import IsAdmin


# ── Config ────────────────────────────────────────────────────────────────────

class AffiliateConfigView(APIView):
    """GET/PATCH /admin/affiliate/config/ — config singleton du programme."""
    permission_classes = [IsAdmin]

    def _serialize(self, cfg):
        return {
            "commission_amount": cfg.commission_amount,
            "min_withdrawal":    cfg.min_withdrawal,
            "whatsapp_number":   cfg.whatsapp_number,
            "is_active":         cfg.is_active,
            "updated_at":        cfg.updated_at,
        }

    def get(self, request):
        return Response(self._serialize(AffiliateConfig.get()))

    def patch(self, request):
        cfg  = AffiliateConfig.get()
        data = request.data
        if "commission_amount" in data:
            cfg.commission_amount = int(data["commission_amount"])
        if "min_withdrawal" in data:
            cfg.min_withdrawal = int(data["min_withdrawal"])
        if "whatsapp_number" in data:
            cfg.whatsapp_number = str(data["whatsapp_number"]).strip()
        if "is_active" in data:
            cfg.is_active = bool(data["is_active"])
        cfg.save()
        record(request.user, AuditAction.UPDATE_CONTENT, target_type="AffiliateConfig",
               target_id=1, payload={k: data[k] for k in data})
        return Response(self._serialize(cfg))


# ── Stats ─────────────────────────────────────────────────────────────────────

class AffiliateStatsView(APIView):
    """GET /admin/affiliate/stats/ — KPIs globaux du programme."""
    permission_classes = [IsAdmin]

    def get(self, request):
        total     = Referral.objects.count()
        pending   = Referral.objects.filter(status=ReferralStatus.PENDING).count()
        validated = Referral.objects.filter(status=ReferralStatus.VALIDATED).count()
        paid      = Referral.objects.filter(status=ReferralStatus.PAID).count()

        agg_all  = (Referral.objects
                    .filter(status__in=[ReferralStatus.VALIDATED, ReferralStatus.PAID])
                    .aggregate(total=Sum("commission")))
        agg_paid = (Referral.objects
                    .filter(status=ReferralStatus.PAID)
                    .aggregate(total=Sum("commission")))

        total_commissions   = agg_all["total"]  or 0
        paid_commissions    = agg_paid["total"] or 0
        pending_commissions = total_commissions - paid_commissions

        top = list(
            Referral.objects
            .filter(status__in=[ReferralStatus.VALIDATED, ReferralStatus.PAID])
            .values("referrer__id", "referrer__full_name", "referrer__email")
            .annotate(count=Count("id"), earned=Sum("commission"))
            .order_by("-earned")[:5]
        )

        return Response({
            "total_referrals":       total,
            "pending_referrals":     pending,
            "validated_referrals":   validated,
            "paid_referrals":        paid,
            "total_commissions":     total_commissions,
            "paid_commissions":      paid_commissions,
            "pending_commissions":   pending_commissions,
            "top_referrers":         top,
        })


# ── Liste des parrainages ─────────────────────────────────────────────────────

class _AffiliatePagination(PageNumberPagination):
    page_size            = 25
    page_size_query_param = "page_size"
    max_page_size        = 100


class AffiliateReferralListView(APIView):
    """GET /admin/affiliate/referrals/ — liste paginée de tous les parrainages."""
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = (Referral.objects
              .select_related("referrer", "referred")
              .order_by("-created_at"))

        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(referrer__full_name__icontains=search) |
                Q(referrer__email__icontains=search) |
                Q(referred__full_name__icontains=search) |
                Q(referred__email__icontains=search)
            )

        paginator = _AffiliatePagination()
        page = paginator.paginate_queryset(qs, request)

        def _ser(r):
            return {
                "id": r.id,
                "referrer": {
                    "id":            r.referrer.id,
                    "full_name":     r.referrer.full_name,
                    "email":         r.referrer.email,
                    "referral_code": r.referrer.referral_code,
                },
                "referred": {
                    "id":        r.referred.id,
                    "full_name": r.referred.full_name,
                    "email":     r.referred.email,
                } if r.referred else None,
                "status":       r.status,
                "commission":   r.commission,
                "created_at":   r.created_at,
                "validated_at": r.validated_at,
                "paid_at":      r.paid_at,
            }

        return paginator.get_paginated_response([_ser(r) for r in page])


# ── Marquer comme payé ────────────────────────────────────────────────────────

class AffiliateMarkPaidView(APIView):
    """POST /admin/affiliate/referrals/pay/ — marque une liste de parrainages VALIDATED → PAID."""
    permission_classes = [IsAdmin]

    def post(self, request):
        ids = request.data.get("ids", [])
        if not ids:
            return Response({"detail": "ids requis."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        updated = (Referral.objects
                   .filter(id__in=ids, status=ReferralStatus.VALIDATED)
                   .update(status=ReferralStatus.PAID, paid_at=now))

        record(request.user, AuditAction.MANUAL_PAYMENT, target_type="Referral",
               target_id=0, payload={"paid_ids": list(ids), "updated": updated})
        return Response({"updated": updated})


# Aliases pour rétrocompatibilité
AdminAffiliateConfigView = AffiliateConfigView
AdminAffiliateStatsView = AffiliateStatsView
AdminAffiliateReferralsView = AffiliateReferralListView
AdminAffiliateMarkPaidView = AffiliateMarkPaidView


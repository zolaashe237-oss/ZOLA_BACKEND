"""Vues membres du système de parrainage."""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Referral
from .services import get_referral_stats


class MyAffiliateView(APIView):
    """GET /affiliate/me/ — code de parrainage, stats et config pour le membre connecté."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(get_referral_stats(request.user))


class MyReferralsView(APIView):
    """GET /affiliate/referrals/ — liste des filleuls du membre connecté."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = (Referral.objects
              .filter(referrer=request.user)
              .select_related("referred")
              .order_by("-created_at"))
        data = [
            {
                "id": r.id,
                "referred_name":  r.referred.full_name if r.referred else "-",
                "referred_email": r.referred.email if r.referred else "-",
                "status":         r.status,
                "commission":     r.commission,
                "created_at":     r.created_at,
                "validated_at":   r.validated_at,
            }
            for r in qs
        ]
        return Response(data)

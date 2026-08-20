"""Squelette du module Affiliation.

Fournit des endpoints stub qui répondent 200/202 vides afin de débloquer les
appels du frontend qui recevaient 404. La logique métier (codes de parrainage,
tracking, commissions) sera ajoutée dans une itération dédiée — voir le
backlog produit.
"""
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


_TAG = "Affiliation (MVP squelette)"
_NOT_IMPLEMENTED = {
    "detail": "Module d'affiliation en préparation — endpoint disponible sans données.",
    "implemented": False,
}


@extend_schema(tags=[_TAG], summary="Racine du module affiliation")
class AffiliationRootView(APIView):
    permission_classes = [AllowAny]

    def get(self, _request):
        return Response(_NOT_IMPLEMENTED)


@extend_schema(tags=[_TAG], summary="Mes informations d'affiliation")
class AffiliationMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, _request):
        return Response({
            "code": None,
            "parrain": None,
            "leads_count": 0,
            "implemented": False,
        })


@extend_schema(tags=[_TAG], summary="Mes filleuls")
class AffiliationLeadsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, _request):
        return Response({"results": [], "count": 0, "implemented": False})


@extend_schema(tags=[_TAG], summary="Lier un code parrain",
               description="Stub : la liaison sera implémentée dans l'itération dédiée.")
class AffiliationLinkView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, _request):
        return Response(_NOT_IMPLEMENTED, status=status.HTTP_202_ACCEPTED)

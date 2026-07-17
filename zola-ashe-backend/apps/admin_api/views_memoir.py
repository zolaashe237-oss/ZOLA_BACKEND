"""Vues admin — Mémoires (demandes de rédaction de livre autobiographique)."""
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.memoir.models import DraftStatus, EditorialStatus, MemoirDraft
from apps.memoir.services import generate_memoir_docx

from .permissions import IsAdmin
from .serializers import AdminMemoirDetailSerializer, AdminMemoirListSerializer

_VALID_EDITORIAL = {s.value for s in EditorialStatus}


class AdminMemoirListView(APIView):
    """GET /api/admin/memoir/ — liste toutes les soumissions reçues."""

    permission_classes = [IsAdmin]

    @extend_schema(
        responses={200: AdminMemoirListSerializer(many=True)},
        summary="Liste des soumissions Mémoire",
    )
    def get(self, request):
        qs = (
            MemoirDraft.objects
            .filter(status=DraftStatus.SUBMITTED)
            .select_related("user")
            .order_by("-submitted_at")
        )
        return Response(AdminMemoirListSerializer(qs, many=True).data)


class AdminMemoirDetailView(APIView):
    """GET + PATCH /api/admin/memoir/{id}/ — détail et mise à jour éditoriale."""

    permission_classes = [IsAdmin]

    def _get_draft(self, pk: int) -> MemoirDraft:
        return get_object_or_404(MemoirDraft, pk=pk, status=DraftStatus.SUBMITTED)

    @extend_schema(
        responses={200: AdminMemoirDetailSerializer},
        summary="Détail d'une soumission Mémoire",
    )
    def get(self, request, pk: int):
        return Response(AdminMemoirDetailSerializer(self._get_draft(pk)).data)

    @extend_schema(
        request=AdminMemoirListSerializer,
        responses={
            200: AdminMemoirDetailSerializer,
            400: OpenApiResponse(description="Statut éditorial invalide"),
        },
        summary="Mettre à jour le statut éditorial ou les notes",
    )
    def patch(self, request, pk: int):
        draft = self._get_draft(pk)

        if "editorial_status" in request.data:
            val = request.data["editorial_status"]
            if val not in _VALID_EDITORIAL:
                return Response(
                    {"detail": f"Statut invalide. Valeurs acceptées : {', '.join(sorted(_VALID_EDITORIAL))}"},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            draft.editorial_status = val

        if "editorial_notes" in request.data:
            draft.editorial_notes = str(request.data["editorial_notes"])

        draft.save()
        return Response(AdminMemoirDetailSerializer(draft).data)


class AdminMemoirDocxView(APIView):
    """GET /api/admin/memoir/{id}/docx/ — téléchargement du mémoire en Word."""

    permission_classes = [IsAdmin]

    @extend_schema(
        responses={200: OpenApiResponse(description="Fichier .docx")},
        summary="Télécharger le mémoire en Word (.docx)",
    )
    def get(self, request, pk: int):
        draft = get_object_or_404(MemoirDraft, pk=pk, status=DraftStatus.SUBMITTED)
        try:
            docx_bytes = generate_memoir_docx(draft)
        except Exception as exc:
            return Response(
                {"detail": f"Génération du document impossible : {exc}"},
                status=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        member_name = getattr(draft.user, "full_name", None) or draft.user.email
        filename = f"memoire_{slugify(member_name)}_{pk}.docx"

        response = HttpResponse(
            docx_bytes,
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

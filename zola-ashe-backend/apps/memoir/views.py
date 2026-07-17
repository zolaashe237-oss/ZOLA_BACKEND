"""Endpoints Mon Histoire — brouillon, soumission et transcription audio."""
import base64
import logging

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger("memoir")

from .models import DraftStatus, MemoirDraft
from .serializers import MemoirDraftSerializer


class MemoirDraftView(APIView):
    """GET → charge le brouillon  |  PATCH → sauvegarde auto."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={200: MemoirDraftSerializer},
        summary="Charger le brouillon Mon Histoire",
    )
    def get(self, request):
        draft, _ = MemoirDraft.objects.get_or_create(user=request.user)
        return Response(MemoirDraftSerializer(draft).data)

    @extend_schema(
        request=MemoirDraftSerializer,
        responses={
            200: MemoirDraftSerializer,
            400: OpenApiResponse(description="Dossier déjà soumis ou données invalides"),
        },
        summary="Sauvegarder le brouillon Mon Histoire (auto-save)",
    )
    def patch(self, request):
        draft, _ = MemoirDraft.objects.get_or_create(user=request.user)

        if draft.status == DraftStatus.SUBMITTED:
            return Response(
                {"detail": "Ce dossier a déjà été soumis et ne peut plus être modifié."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MemoirDraftSerializer(draft, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class MemoirSubmitView(APIView):
    """POST → soumission définitive (irréversible)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=None,
        responses={
            200: OpenApiResponse(description="Soumission confirmée"),
            400: OpenApiResponse(description="Dossier déjà soumis"),
        },
        summary="Soumettre définitivement le dossier Mon Histoire",
    )
    def post(self, request):
        draft, _ = MemoirDraft.objects.get_or_create(user=request.user)

        if draft.status == DraftStatus.SUBMITTED:
            return Response(
                {"detail": "Ce dossier a déjà été soumis."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        draft.submit()
        return Response(
            {
                "detail": "Votre histoire a bien été soumise. L'équipe éditoriale vous contactera prochainement.",
                "submitted_at": draft.submitted_at,
            }
        )


class TranscribeView(APIView):
    """POST — transcrit un enregistrement audio via Gemini."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    @extend_schema(
        request={"multipart/form-data": {"type": "object", "properties": {"audio": {"type": "string", "format": "binary"}}}},
        responses={
            200: OpenApiResponse(description="{'transcript': '...'}"),
            400: OpenApiResponse(description="Fichier audio manquant"),
            503: OpenApiResponse(description="Service IA indisponible"),
        },
        summary="Transcription audio (Gemini) pour Mon Histoire",
    )
    def post(self, request):
        audio_file = request.FILES.get("audio")
        if not audio_file:
            return Response({"detail": "Fichier audio requis (champ 'audio')."}, status=status.HTTP_400_BAD_REQUEST)

        mime_type = audio_file.content_type or "audio/webm"
        audio_b64 = base64.b64encode(audio_file.read()).decode("utf-8")

        try:
            from apps.ai_quiz.gemini_client import get_model
            model = get_model()
            response = model.generate_content([
                {"mime_type": mime_type, "data": audio_b64},
                (
                    "Transcris fidèlement ce témoignage oral en français. "
                    "Conserve le style parlé et les tournures naturelles. "
                    "Ne corrige pas les imperfections grammaticales du registre oral. "
                    "Renvoie uniquement la transcription, sans commentaire ni ajout."
                ),
            ])
            transcript = (response.text or "").strip()
            logger.info("memoir.transcribe user=%s chars=%d", request.user.email, len(transcript))
            return Response({"transcript": transcript})
        except Exception as exc:
            logger.exception("memoir.transcribe échec user=%s", request.user.email)
            return Response(
                {"detail": f"Transcription indisponible : {exc}"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

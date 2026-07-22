"""Endpoints de l'agent IA — génération, statut, correction QRO, file de revue admin."""
from __future__ import annotations

import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.admin_api.permissions import IsAdmin

from .gemini_client import AIGenerationError, generate_json
from .models import (
    AIQROAnswer,
    AIQuestion,
    AIQuizJob,
    JobStatus,
    QROVerdict,
    QuestionKind,
)
from .prompts import (
    QRO_EVALUATION_SCHEMA,
    PromptValidationError,
    build_qro_evaluation_prompt,
    validate_qro_evaluation_output,
)
from .serializers import (
    AIQROAnswerSerializer,
    AIQuizJobSerializer,
    GenerationRequestSerializer,
    QRODecideSerializer,
    QROSubmitSerializer,
)
from .tasks import generate_quiz_task

logger = logging.getLogger("ai_quiz")


class GenerateQuizView(GenericAPIView):
    """POST /api/admin/quiz/generate-ai/ — crée un job de génération asynchrone."""

    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = GenerationRequestSerializer

    @extend_schema(
        summary="Lancer la génération d'un quiz par l'agent IA",
        description=(
            "Crée un AIQuizJob et lance la génération en tâche asynchrone. "
            "Retourne immédiatement `job_id` — utiliser l'endpoint de statut "
            "pour récupérer les questions une fois DONE."
        ),
        request=GenerationRequestSerializer,
        responses={
            202: OpenApiResponse(response=AIQuizJobSerializer, description="Job créé et lancé."),
            400: OpenApiResponse(description="Payload invalide."),
            403: OpenApiResponse(description="Réservé aux administrateurs."),
        },
        tags=["Agent IA"],
    )
    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        job = AIQuizJob.objects.create(
            module_id=data["module_id"],
            source_type=data["source_type"],
            source_ref=data.get("source_ref") or "",
            source_text=data.get("source_text") or "",
            config={
                "nb_questions": data["nb_questions"],
                "nb_qcm_multi": data.get("nb_qcm_multi", 0),
                "ratio_qcm_qro": data["ratio_qcm_qro"],
                "difficulty": data["difficulty"],
                "formation_title": data.get("formation_title", ""),
                "module_title": data.get("module_title", ""),
            },
            created_by=request.user,
            status=JobStatus.PENDING,
        )
        generate_quiz_task.delay(str(job.id))

        return Response(
            AIQuizJobSerializer(job).data,
            status=status.HTTP_202_ACCEPTED,
        )


class GenerationStatusView(GenericAPIView):
    """GET /api/admin/quiz/generate-ai/<job_id>/ — polling du statut du job."""

    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = AIQuizJobSerializer
    lookup_field = "id"
    lookup_url_kwarg = "job_id"

    @extend_schema(
        summary="Suivre l'état d'un job de génération IA",
        description=(
            "Polling à faire côté back-office jusqu'à `status=DONE` (ou `FAILED`). "
            "Quand DONE, la réponse inclut la liste des `questions` générées, "
            "avec le niveau et le rang suggérés (si IA-B8 a tourné)."
        ),
        responses={
            200: OpenApiResponse(response=AIQuizJobSerializer),
            404: OpenApiResponse(description="Job introuvable."),
        },
        tags=["Agent IA"],
    )
    def get(self, request, job_id):
        job = get_object_or_404(
            AIQuizJob.objects.select_related("module", "resulting_quiz")
                             .prefetch_related("questions"),
            pk=job_id,
        )
        return Response(AIQuizJobSerializer(job).data)


class SubmitQROView(GenericAPIView):
    """POST /api/quiz/<question_id>/submit-qro/ — soumission et correction QRO (IA-B9)."""

    permission_classes = [IsAuthenticated]
    serializer_class = QROSubmitSerializer

    @extend_schema(
        summary="Soumettre la réponse d'un membre à une question ouverte (QRO)",
        description=(
            "Corrige la réponse via Gemini et retourne verdict + score /20 + "
            "justification. Si l'IA n'est pas disponible, la réponse est "
            "enregistrée avec verdict `NEEDS_REVIEW` — un admin tranchera via "
            "la file de revue (IA-B10)."
        ),
        request=QROSubmitSerializer,
        responses={
            200: OpenApiResponse(response=AIQROAnswerSerializer),
            404: OpenApiResponse(description="Question introuvable ou non publiée."),
            409: OpenApiResponse(description="Réponse déjà tranchée par un admin."),
        },
        tags=["Agent IA"],
    )
    def post(self, request, question_id: int):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        answer_text = serializer.validated_data["answer_text"].strip()

        question = get_object_or_404(
            AIQuestion.objects.select_related("job", "job__module"),
            pk=question_id,
            kind=QuestionKind.QRO,
            is_published=True,
        )

        # Une seule réponse par (question, user). Si l'admin a déjà tranché,
        # on ne réévalue pas — 409 (Cabrel côté front affiche "déjà corrigé").
        existing = (
            AIQROAnswer.objects
            .filter(question=question, user=request.user)
            .first()
        )
        if existing and existing.admin_decision:
            return Response(
                {"detail": "Cette réponse a déjà été tranchée par un correcteur."},
                status=status.HTTP_409_CONFLICT,
            )

        # Appel Gemini synchrone (~2-5s, on peut attendre côté UI)
        verdict, score, justification = _evaluate_qro(
            source_text=question.job.source_text,
            question_text=question.text,
            criteria=question.criteria,
            student_answer=answer_text,
        )

        if existing:
            existing.answer_text = answer_text
            existing.verdict = verdict
            existing.score = score
            existing.justification = justification
            existing.ai_evaluated_at = timezone.now()
            existing.save(update_fields=[
                "answer_text", "verdict", "score", "justification", "ai_evaluated_at",
            ])
            answer = existing
        else:
            answer = AIQROAnswer.objects.create(
                question=question,
                user=request.user,
                answer_text=answer_text,
                verdict=verdict,
                score=score,
                justification=justification,
                ai_evaluated_at=timezone.now(),
            )

        return Response(AIQROAnswerSerializer(answer).data)


def _evaluate_qro(
    *,
    source_text: str,
    question_text: str,
    criteria: list,
    student_answer: str,
) -> tuple[str, int, str]:
    """Appelle Gemini pour corriger une QRO. Fallback NEEDS_REVIEW si erreur."""
    prompt = build_qro_evaluation_prompt(
        source_text=source_text or "(pas de contenu source disponible)",
        question_text=question_text,
        criteria=list(criteria or []),
        student_answer=student_answer,
    )
    try:
        raw = generate_json(prompt, schema=QRO_EVALUATION_SCHEMA)
        parsed = validate_qro_evaluation_output(raw)
    except (AIGenerationError, PromptValidationError) as exc:
        logger.warning("qro.eval.fail → %s", exc)
        return (
            QROVerdict.NEEDS_REVIEW,
            0,
            "Correction automatique indisponible, un correcteur va trancher.",
        )
    return parsed["verdict"], parsed["score"], parsed["justification"]


# --- IA-B10 : file de revue admin des QRO ambiguës --------------------------

class QROReviewListView(GenericAPIView):
    """GET /api/admin/quiz/qro-review/ — file des QRO à trancher (paginée)."""

    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = AIQROAnswerSerializer

    @extend_schema(
        summary="Liste des réponses QRO en attente de décision admin",
        description=(
            "Réponses IA marquées `NEEDS_REVIEW` et pas encore tranchées. "
            "Filtres : `?question_id=<id>` pour ne voir qu'une question, "
            "`?since=YYYY-MM-DD` pour ne voir que les soumissions récentes."
        ),
        responses={200: AIQROAnswerSerializer(many=True)},
        tags=["Agent IA"],
    )
    def get(self, request):
        qs = (
            AIQROAnswer.objects
            .select_related("question", "user")
            .filter(verdict=QROVerdict.NEEDS_REVIEW, admin_decision="")
            .order_by("-submitted_at")
        )

        question_id = request.query_params.get("question_id")
        if question_id:
            try:
                qs = qs.filter(question_id=int(question_id))
            except ValueError:
                return Response(
                    {"detail": "question_id doit être un entier."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        since = request.query_params.get("since")
        if since:
            from django.utils.dateparse import parse_date
            since_date = parse_date(since)
            if not since_date:
                return Response(
                    {"detail": "since doit être au format YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(submitted_at__date__gte=since_date)

        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(
                AIQROAnswerSerializer(page, many=True).data
            )
        return Response(AIQROAnswerSerializer(qs, many=True).data)


class QROReviewDecideView(GenericAPIView):
    """POST /api/admin/quiz/qro-review/<answer_id>/decide/ — tranche une réponse."""

    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = QRODecideSerializer

    @extend_schema(
        summary="Trancher une réponse QRO en attente",
        description=(
            "Enregistre la décision de l'admin (VALIDATED ou REJECTED) sur une "
            "réponse marquée `NEEDS_REVIEW` par l'IA. Décision unique et "
            "irréversible : 409 si déjà tranchée."
        ),
        request=QRODecideSerializer,
        responses={
            200: OpenApiResponse(response=AIQROAnswerSerializer),
            404: OpenApiResponse(description="Réponse introuvable."),
            409: OpenApiResponse(description="Réponse déjà tranchée."),
        },
        tags=["Agent IA"],
    )
    def post(self, request, answer_id: int):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        answer = get_object_or_404(
            AIQROAnswer.objects.select_related("question", "user"),
            pk=answer_id,
        )
        if answer.admin_decision:
            return Response(
                {"detail": "Cette réponse a déjà été tranchée."},
                status=status.HTTP_409_CONFLICT,
            )

        answer.admin_decision = serializer.validated_data["decision"]
        answer.admin_note = serializer.validated_data.get("note", "")
        answer.admin_decided_by = request.user
        answer.admin_decided_at = timezone.now()
        answer.save(update_fields=[
            "admin_decision", "admin_note", "admin_decided_by", "admin_decided_at",
        ])
        logger.info(
            "qro.decide answer=%s admin=%s decision=%s",
            answer.id, request.user.id, answer.admin_decision,
        )
        return Response(AIQROAnswerSerializer(answer).data)

"""Serializers — validation des entrées et sortie des endpoints IA."""
from __future__ import annotations

from rest_framework import serializers

from apps.content.models import Module

from .models import (
    AIQROAnswer,
    AIQuestion,
    AIQuizJob,
    DifficultyLevel,
    SourceType,
)


class GenerationRequestSerializer(serializers.Serializer):
    """Payload POST /api/admin/quiz/generate-ai/."""

    module_id = serializers.IntegerField(min_value=1)
    source_type = serializers.ChoiceField(choices=SourceType.choices)
    source_ref = serializers.CharField(required=False, allow_blank=True, max_length=500)
    source_text = serializers.CharField(required=False, allow_blank=True)

    nb_questions = serializers.IntegerField(required=False, min_value=3, max_value=20, default=5)
    nb_qcm_multi = serializers.IntegerField(required=False, min_value=0, max_value=10, default=0)
    ratio_qcm_qro = serializers.FloatField(required=False, min_value=0.0, max_value=1.0, default=0.6)
    difficulty = serializers.ChoiceField(
        required=False, choices=DifficultyLevel.choices, default=DifficultyLevel.INTERMEDIAIRE
    )
    formation_title = serializers.CharField(required=False, allow_blank=True, max_length=300)
    module_title = serializers.CharField(required=False, allow_blank=True, max_length=300)

    def validate_module_id(self, value: int) -> int:
        if not Module.objects.filter(pk=value).exists():
            raise serializers.ValidationError(f"Module {value} introuvable.")
        return value

    def validate(self, attrs: dict) -> dict:
        src_type = attrs["source_type"]
        src_ref = (attrs.get("source_ref") or "").strip()
        src_text = (attrs.get("source_text") or "").strip()

        if src_type == SourceType.VIDEO_YOUTUBE and not src_ref:
            raise serializers.ValidationError(
                {"source_ref": "URL YouTube requise pour ce source_type."}
            )
        if src_type == SourceType.MULTI_YOUTUBE and not src_ref:
            raise serializers.ValidationError(
                {"source_ref": "Liste d'URLs YouTube (séparées par des virgules) requise pour MULTI_YOUTUBE."}
            )
        if src_type == SourceType.PDF and not src_ref:
            raise serializers.ValidationError(
                {"source_ref": "resource_id du PDF requis pour ce source_type."}
            )
        if src_type == SourceType.PDF:
            try:
                int(src_ref)
            except ValueError:
                raise serializers.ValidationError(
                    {"source_ref": "source_ref doit être un resource_id entier."}
                )
        if src_type == SourceType.MANUAL_TEXT and not src_text:
            raise serializers.ValidationError(
                {"source_text": "Texte source requis pour source_type=MANUAL_TEXT."}
            )

        attrs["source_ref"] = src_ref
        attrs["source_text"] = src_text
        return attrs


class AIQuestionSerializer(serializers.ModelSerializer):
    """Question générée — utilisée en sortie de l'endpoint statut (IA-B7)."""

    class Meta:
        model = AIQuestion
        fields = (
            "id", "kind", "text", "order", "choices", "correct_index",
            "correct_indices", "criteria", "is_published", "edited_by_admin",
            "created_at", "updated_at",
        )
        read_only_fields = fields


class AIQuizJobSerializer(serializers.ModelSerializer):
    """Retour de POST generate-ai (job créé) et polling GET (IA-B7)."""

    questions = AIQuestionSerializer(many=True, read_only=True)

    class Meta:
        model = AIQuizJob
        fields = (
            "id", "module", "status", "source_type", "source_ref",
            "config", "suggested_level", "suggested_rank",
            "resulting_quiz", "error_message",
            "created_at", "started_at", "finished_at",
            "questions",
        )
        read_only_fields = fields


class QROSubmitSerializer(serializers.Serializer):
    """Payload POST /api/quiz/{question_id}/submit-qro/ (IA-B9)."""
    answer_text = serializers.CharField(min_length=1, max_length=5000)


class AIQROAnswerSerializer(serializers.ModelSerializer):
    """Retour d'une correction QRO ou d'une entrée de la file de revue admin."""

    final_verdict = serializers.CharField(read_only=True)

    class Meta:
        model = AIQROAnswer
        fields = (
            "id", "question", "user", "answer_text",
            "verdict", "score", "justification",
            "admin_decision", "admin_note", "final_verdict",
            "submitted_at", "ai_evaluated_at", "admin_decided_at",
        )
        read_only_fields = fields


class QRODecideSerializer(serializers.Serializer):
    """Payload POST /api/admin/quiz/qro-review/{id}/decide/ (IA-B10)."""
    decision = serializers.ChoiceField(choices=["VALIDATED", "REJECTED"])
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000)

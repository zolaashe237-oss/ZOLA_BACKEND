"""Modèles de l'agent IA — jobs de génération, questions générées, réponses QRO.

Trois tables :
  - AIQuizJob     : une demande de génération (statut, source, config, résultat).
  - AIQuestion    : une question produite par l'agent (QCM ou QRO).
  - AIQROAnswer   : une réponse membre à une QRO + verdict IA + décision admin.

Les questions générées vivent d'abord dans `AIQuestion` (draft, éditables par
l'admin). Elles sont recopiées dans `content.Question` seulement à la publication
du quiz (workflow assumé par IA-B6/B7 côté endpoints).
"""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class JobStatus(models.TextChoices):
    PENDING = "PENDING", "En attente"
    IN_PROGRESS = "IN_PROGRESS", "En cours"
    DONE = "DONE", "Terminé"
    FAILED = "FAILED", "Échec"


class SourceType(models.TextChoices):
    VIDEO_YOUTUBE = "VIDEO_YOUTUBE", "Vidéo YouTube (captions)"
    PDF = "PDF", "Document PDF"
    MANUAL_TEXT = "MANUAL_TEXT", "Texte saisi manuellement"
    MULTI_YOUTUBE = "MULTI_YOUTUBE", "Plusieurs vidéos YouTube (examen final)"


class QuestionKind(models.TextChoices):
    QCM       = "QCM",       "Question à choix multiple (1 bonne réponse)"
    QCM_MULTI = "QCM_MULTI", "Question à choix multiples (plusieurs bonnes réponses)"
    QRO       = "QRO",       "Question à réponse ouverte"


class DifficultyLevel(models.TextChoices):
    """Niveau retourné par la classification IA-B8 et éditable par l'admin."""
    FACILE = "FACILE", "Facile"
    INTERMEDIAIRE = "INTERMEDIAIRE", "Intermédiaire"
    DIFFICILE = "DIFFICILE", "Difficile"


class QROVerdict(models.TextChoices):
    VALIDATED = "VALIDATED", "Validé"
    REJECTED = "REJECTED", "Non validé"
    NEEDS_REVIEW = "NEEDS_REVIEW", "À revoir manuellement"


class AIQuizJob(models.Model):
    """Une tentative de génération d'un quiz par l'agent IA."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    module = models.ForeignKey(
        "content.Module",
        on_delete=models.CASCADE,
        related_name="ai_quiz_jobs",
        help_text="Module source du quiz.",
    )
    status = models.CharField(
        max_length=16, choices=JobStatus.choices, default=JobStatus.PENDING
    )
    source_type = models.CharField(max_length=16, choices=SourceType.choices)
    source_ref = models.CharField(
        max_length=500,
        blank=True,
        help_text="URL YouTube, resource_id PDF, ou vide si texte manuel.",
    )
    source_text = models.TextField(
        blank=True,
        help_text="Texte extrait (transcription YouTube, PDF parsé) ou saisi manuellement.",
    )

    config = models.JSONField(
        default=dict,
        help_text="Paramètres de génération : nb_questions, ratio_qcm_qro, difficulty.",
    )
    raw_ai_output = models.JSONField(
        default=dict, blank=True, help_text="Réponse Gemini brute (debug)."
    )

    suggested_level = models.CharField(
        max_length=16, choices=DifficultyLevel.choices, blank=True
    )
    suggested_rank = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Rang suggéré dans le parcours de la branche (IA-B8).",
    )

    resulting_quiz = models.ForeignKey(
        "content.Quiz",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="+",
        help_text="Quiz publié à partir de ce job (rempli à la publication).",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="ai_quiz_jobs",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    class Meta:
        db_table = "ai_quiz_jobs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["module", "-created_at"]),
        ]

    def __str__(self):
        return f"AIQuizJob<{self.id} module={self.module_id} {self.status}>"


class AIQuestion(models.Model):
    """Question produite par l'agent (draft, éditable avant publication)."""

    job = models.ForeignKey(
        AIQuizJob, on_delete=models.CASCADE, related_name="questions"
    )
    kind = models.CharField(max_length=16, choices=QuestionKind.choices)
    text = models.TextField()
    order = models.PositiveIntegerField(default=0)

    # QCM : choix + index de la bonne réponse (0-based).
    choices = models.JSONField(
        default=list,
        blank=True,
        help_text='Pour QCM/QCM_MULTI: liste de 4–5 strings. Vide pour QRO.',
    )
    correct_index = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text='Pour QCM: index de la bonne réponse. Null pour QCM_MULTI et QRO.',
    )
    correct_indices = models.JSONField(
        default=list,
        blank=True,
        help_text='Pour QCM_MULTI: liste des indices corrects (ex: [0, 2]). Vide pour QCM/QRO.',
    )

    # QRO : critères d'évaluation utilisés par le pipeline de correction.
    criteria = models.JSONField(
        default=list,
        blank=True,
        help_text='Pour QRO: liste de critères ("doit citer X", "doit expliquer Y").',
    )

    is_published = models.BooleanField(
        default=False,
        help_text="Passe à True quand l'admin publie ce quiz (recopié dans content.Question).",
    )
    edited_by_admin = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_quiz_questions"
        ordering = ["job_id", "order", "id"]
        indexes = [models.Index(fields=["job", "kind"])]

    def __str__(self):
        return f"AIQuestion<{self.id} {self.kind}>"


class AIQROAnswer(models.Model):
    """Réponse d'un membre à une QRO, corrigée sémantiquement par Gemini."""

    question = models.ForeignKey(
        AIQuestion, on_delete=models.CASCADE, related_name="qro_answers"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_qro_answers",
    )
    answer_text = models.TextField()

    verdict = models.CharField(
        max_length=16, choices=QROVerdict.choices, default=QROVerdict.NEEDS_REVIEW
    )
    score = models.PositiveSmallIntegerField(
        default=0, help_text="Note sur 20 attribuée par Gemini."
    )
    justification = models.TextField(blank=True)

    submitted_at = models.DateTimeField(auto_now_add=True)
    ai_evaluated_at = models.DateTimeField(null=True, blank=True)

    # Arbitrage admin (utilisé quand verdict = NEEDS_REVIEW).
    admin_decision = models.CharField(
        max_length=16, choices=QROVerdict.choices, blank=True
    )
    admin_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="qro_decisions_made",
    )
    admin_decided_at = models.DateTimeField(null=True, blank=True)
    admin_note = models.TextField(blank=True)

    class Meta:
        db_table = "ai_qro_answers"
        ordering = ["-submitted_at"]
        indexes = [
            models.Index(fields=["verdict"]),
            models.Index(fields=["user", "-submitted_at"]),
        ]

    def __str__(self):
        return f"AIQROAnswer<{self.id} user={self.user_id} {self.verdict}>"

    @property
    def final_verdict(self) -> str:
        """Verdict effectif : décision admin si présente, sinon verdict IA."""
        return self.admin_decision or self.verdict

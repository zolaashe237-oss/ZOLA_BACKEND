"""Brouillon et soumission du questionnaire autobiographique « Mon Histoire »."""
from django.conf import settings
from django.db import models
from django.utils import timezone


class DraftStatus(models.TextChoices):
    DRAFT = "draft", "Brouillon"
    SUBMITTED = "submitted", "Soumis"


class EditorialStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    IN_PROGRESS = "in_progress", "En cours de rédaction"
    REVIEW = "review", "En relecture"
    COMPLETED = "completed", "Terminé"
    ARCHIVED = "archived", "Archivé"


class MemoirDraft(models.Model):
    """Un par utilisateur — brouillon auto-sauvegardé + soumission définitive."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="memoir_draft",
    )
    answers = models.JSONField(
        default=dict,
        blank=True,
        help_text="Dictionnaire {question_id: {text, audioTranscript, imageCaptions, structured, notApplicable}}",
    )
    status = models.CharField(
        max_length=20,
        choices=DraftStatus.choices,
        default=DraftStatus.DRAFT,
    )
    editorial_status = models.CharField(
        max_length=20,
        choices=EditorialStatus.choices,
        default=EditorialStatus.PENDING,
    )
    editorial_notes = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Mémoire — brouillon"
        verbose_name_plural = "Mémoires — brouillons"

    def __str__(self) -> str:
        return f"Memoir({self.user.email}) — {self.status}"

    def submit(self) -> None:
        self.status = DraftStatus.SUBMITTED
        self.submitted_at = timezone.now()
        self.save(update_fields=["status", "submitted_at", "updated_at"])

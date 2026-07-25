from django.conf import settings
from django.db import models


class NotifType(models.TextChoices):
    PAIEMENT   = "PAIEMENT",   "Paiement confirmé"
    MODERATION = "MODERATION", "Contenu retiré"
    SYSTEME    = "SYSTEME",    "Système"


class Notification(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    type       = models.CharField(max_length=20, choices=NotifType.choices, default=NotifType.SYSTEME)
    title      = models.CharField(max_length=200)
    body       = models.TextField(blank=True)
    read       = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.type}] user={self.user_id}: {self.title}"

"""Journal d'audit append-only (CDC §7.6).

Aucun UPDATE/DELETE n'est autorisé via l'ORM : voir save()/delete() surchargés.
Conservation minimale 2 ans. Écriture réservée à l'API admin backend.
"""
from django.db import models


class AuditAction(models.TextChoices):
    BLOCK_USER = "BLOCK_USER", "Blocage membre"
    UNBLOCK_USER = "UNBLOCK_USER", "Déblocage membre"
    DELETE_POST = "DELETE_POST", "Suppression publication"
    DELETE_COMMENT = "DELETE_COMMENT", "Suppression commentaire"
    RESOLVE_REPORT = "RESOLVE_REPORT", "Traitement signalement"
    WARN_USER = "WARN_USER", "Avertissement membre"
    MANUAL_PAYMENT = "MANUAL_PAYMENT", "Validation paiement manuel"
    CLOSE_SUBSCRIPTION = "CLOSE_SUBSCRIPTION", "Clôture d'adhésion (membre)"
    DELETE_ACCOUNT = "DELETE_ACCOUNT", "Suppression de compte (RGPD)"
    GRANT_BRANCH = "GRANT_BRANCH", "Attribution accès branche"
    REVOKE_BRANCH = "REVOKE_BRANCH", "Révocation accès branche"
    RESET_QUIZ = "RESET_QUIZ", "Réinitialisation quiz"
    UPDATE_CONTENT = "UPDATE_CONTENT", "Modification contenu"
    DELETE_CONTENT = "DELETE_CONTENT", "Suppression contenu"
    EXPORT_DATA = "EXPORT_DATA", "Export de données"
    SEND_REMINDER = "SEND_REMINDER", "Envoi relance"
    SEND_NOTIFICATION = "SEND_NOTIFICATION", "Envoi notification système"


class AuditLog(models.Model):
    actor = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="audit_logs")
    action = models.CharField(max_length=32, choices=AuditAction.choices)
    target_type = models.CharField(max_length=50, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_logs"
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise PermissionError("AUDIT_LOGS est append-only : modification interdite.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("AUDIT_LOGS est append-only : suppression interdite.")

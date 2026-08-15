from django.conf import settings
from django.db import models
from apps.notifications.db_functions import DbFunctions


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


class WhatsAppTemplate(models.Model):
    """Modèle pour les messages WhatsApp prédéfinis (Twilio Content Templates)."""
    name = models.CharField(max_length=128, unique=True, help_text="Nom du template chez Twilio")
    slug = models.SlugField(max_length=128, unique=True, help_text="Identifiant logique pour le code")
    body = models.TextField(help_text="Corps du message avec placeholders {{1}}, {{2}}…")
    category = models.CharField(max_length=50, blank=True, default="UTILITY",
                                help_text="Catégorie Twilio : MARKETING, UTILITY, AUTHENTICATION")
    language = models.CharField(max_length=10, default="fr", help_text="Code langue (fr, en…)")
    is_active = models.BooleanField(default=True)
    variables_count = models.PositiveIntegerField(default=0,
                                                  help_text="Nombre de variables/placeholders dans le template")
    twilio_template_sid = models.CharField(max_length=255, blank=True,
                                           help_text="Identifiant Twilio du Content Template (optionnel)")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "whatsapp_templates"
        ordering = ["-created_at"]
        verbose_name = "Template WhatsApp"
        verbose_name_plural = "Templates WhatsApp"

    def __str__(self):
        return f"{self.name} ({self.slug})"
    
    def save(self, *args, **kwargs) -> None:
        if not self.slug:
            self.slug = DbFunctions.unique_slug_generator_by_name(self)
        super().save(*args, **kwargs)

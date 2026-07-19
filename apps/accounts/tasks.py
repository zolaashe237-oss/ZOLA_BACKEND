"""Tâches asynchrones de l'app accounts — envois d'emails (Brevo) et WhatsApp (Twilio)."""
import logging

from django.conf import settings
from django.core.mail import send_mail

from config.celery import app

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_whatsapp_message(self, to_number: str, template_name: str, variables: dict | None = None):
    """Envoie un message WhatsApp via Twilio (asynchrone, avec retry automatique).

    Recherche le template en base par son nom logique, puis appelle le service.
    En cas d'échec de l'API Twilio, la tâche est réessayée 3 fois à 60s d'intervalle.
    """
    from .models import WhatsAppTemplate
    from .services import send_whatsapp_message as _send

    try:
        tmpl = WhatsAppTemplate.objects.get(name=template_name, is_active=True)
    except WhatsAppTemplate.DoesNotExist:
        logger.error("WhatsApp template '%s' introuvable ou inactif.", template_name)
        return f"template '{template_name}' not found"

    sid = _send(to_number, tmpl.content_sid, variables)
    if sid is None:
        raise self.retry(exc=Exception(f"Twilio send failed for {template_name} → {to_number}"))
    return f"whatsapp sent: {sid}"


@app.task
def send_otp_email(email: str, code: str, purpose: str = "verification"):
    """Envoie le code OTP par email (asynchrone, non bloquant).

    purpose : 'verification' (activation compte) ou 'reset' (mot de passe oublié).
    """
    if purpose == "reset":
        subject = "ZOLA ASHÉ — Réinitialisation de votre mot de passe"
        body = (
            f"Votre code de réinitialisation est : {code}\n"
            f"Il expire dans {settings.OTP_TTL_MINUTES} minutes.\n\n"
            "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
        )
    else:
        subject = "ZOLA ASHÉ — Activez votre compte"
        body = (
            f"Bienvenue ! Votre code de vérification est : {code}\n"
            f"Il expire dans {settings.OTP_TTL_MINUTES} minutes."
        )

    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )
    return f"otp email sent: {email} ({purpose})"

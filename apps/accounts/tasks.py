"""Tâches asynchrones de l'app accounts — envois d'emails via Brevo (CDC §3.3)."""
from django.conf import settings
from django.core.mail import send_mail

from config.celery import app


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

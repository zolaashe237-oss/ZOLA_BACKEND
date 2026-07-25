"""Tâches asynchrones de l'app accounts — envois d'emails via Brevo (CDC §3.3)."""
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

from config.celery import app


@app.task
def send_otp_email(email: str, code: str, purpose: str = "verification"):
    """Envoie le code OTP par email (asynchrone, non bloquant).

    purpose : 'verification' (activation compte) ou 'reset' (mot de passe oublié).
    """
    ctx = {
        "code": code,
        "ttl": settings.OTP_TTL_MINUTES,
        "year": timezone.now().year,
    }

    if purpose == "reset":
        subject = "ZOLA ASHÉ — Réinitialisation de votre mot de passe"
        template = "emails/otp_reset.html"
        plain = (
            f"Votre code de réinitialisation est : {code}\n"
            f"Il expire dans {settings.OTP_TTL_MINUTES} minutes.\n\n"
            "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
        )
    elif purpose == "email_change":
        subject = "ZOLA ASHÉ — Confirmez votre nouvelle adresse email"
        template = "emails/otp_verification.html"
        plain = (
            f"Votre code de confirmation est : {code}\n"
            f"Il expire dans {settings.OTP_TTL_MINUTES} minutes.\n\n"
            "Si vous n'avez pas demandé à changer votre email, ignorez cet email."
        )
    else:
        subject = "ZOLA ASHÉ — Activez votre compte"
        template = "emails/otp_verification.html"
        plain = (
            f"Bienvenue ! Votre code de vérification est : {code}\n"
            f"Il expire dans {settings.OTP_TTL_MINUTES} minutes."
        )

    html = render_to_string(template, ctx)
    msg = EmailMultiAlternatives(
        subject=subject,
        body=plain,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[email],
    )
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=False)

    try:
        from apps.accounts.models import User
        from apps.notifications.whatsapp import send_whatsapp_message
        user = User.objects.get(email=email)
        if user.phone:
            whatsapp_msg = f"ZOLA ASHÉ - Votre code est : {code}. Il expire dans {settings.OTP_TTL_MINUTES} minutes."
            send_whatsapp_message(user.phone, whatsapp_msg)
    except Exception:
        pass

    return f"otp email sent: {email} ({purpose})"

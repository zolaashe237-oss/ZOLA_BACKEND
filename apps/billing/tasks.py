"""Tâches asynchrones billing — cron de statut et emails Brevo (RG-02/03/07)."""
from django.conf import settings
from django.core.mail import send_mail

from config.celery import app


@app.task
def daily_status_check():
    """Cron quotidien (00h00 UTC) : statuts membres + rappels (RG-02/03)."""
    from .services import run_daily_status_check
    summary = run_daily_status_check()
    return f"daily_status_check: {summary}"


@app.task
def send_confirmation_email(email: str, kind: str):
    """Confirme un paiement validé."""
    labels = {
        "INSCRIPTION": "votre adhésion à la communauté",
        "COTISATION": "votre cotisation mensuelle",
        "DON": "votre don à la communauté",
    }
    libelle = labels.get(kind, "votre paiement")
    send_mail(
        subject="ZOLA ASHÉ — Paiement confirmé",
        message=f"Nous confirmons {libelle}. Merci de votre confiance.",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )
    return f"confirmation sent: {email} ({kind})"


@app.task
def send_payment_reminder(user_id: int):
    """Rappel de cotisation à un membre (RG-03, J1/J7/J15)."""
    from apps.accounts.models import User
    user = User.objects.filter(id=user_id).first()
    if user is None:
        return "user introuvable"
    send_mail(
        subject="ZOLA ASHÉ — Rappel de cotisation",
        message=("Votre cotisation mensuelle est en attente. "
                 "Réglez-la depuis votre espace pour conserver votre accès."),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )
    return f"reminder sent: {user_id}"

"""Tâches asynchrones billing — cron de statut et emails (RG-02/03/07)."""
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, send_mail
from django.template.loader import render_to_string
from django.utils import timezone

from config.celery import app


@app.task
def daily_status_check():
    """Cron quotidien (00h00 UTC) : statuts membres + rappels (RG-02/03)."""
    from .services import run_daily_status_check
    summary = run_daily_status_check()
    return f"daily_status_check: {summary}"


@app.task
def send_confirmation_email(email: str, kind: str,
                             full_name: str = "", amount: int | None = None):
    """Envoie l'email de confirmation de paiement (HTML + texte brut)."""
    labels = {
        "INSCRIPTION": "votre adhésion à la communauté",
        "COTISATION": "votre cotisation mensuelle",
        "DON": "votre don à la communauté",
        "BRANCHE_FEMME": "votre accès Branche Femme",
        "BRANCHE_ENFANT": "votre accès Branche Enfant",
    }
    libelle = labels.get(kind, "votre paiement")

    now = timezone.now()
    ctx = {
        "kind": kind,
        "full_name": full_name,
        "amount": amount,
        "date": now.strftime("%d/%m/%Y"),
        "web_base_url": settings.WEB_BASE_URL,
        "year": now.year,
    }
    html = render_to_string("emails/payment_confirmation.html", ctx)
    plain = (
        f"Bonjour{' ' + full_name if full_name else ''},\n\n"
        f"Nous confirmons {libelle}. Merci de votre confiance.\n\n"
        f"Accédez à votre espace : {settings.WEB_BASE_URL}/espace-membre"
    )

    msg = EmailMultiAlternatives(
        subject="ZOLA ASHÉ — Paiement confirmé",
        body=plain,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[email],
    )
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=False)

    try:
        from apps.accounts.models import User
        from apps.notifications.whatsapp import WhatsAppService
        user = User.objects.get(email=email)
        if user.phone:
            service = WhatsAppService()
            service.send_template_message(
                phone_number=user.phone,
                template_slug="payment_confirmation",
                variables={"libelle": libelle},
            )
    except Exception:
        pass

    return f"confirmation sent: {email} ({kind})"


@app.task
def send_payment_reminder(user_id: int):
    """Rappel de cotisation à un membre (RG-03, J1/J7/J15)."""
    from apps.accounts.models import User
    user = User.objects.filter(id=user_id).first()
    if user is None:
        return "user introuvable"

    first_name = (user.full_name or "").split()[0] if user.full_name else ""
    ctx = {
        "first_name": first_name,
        "app_url": f"{settings.WEB_BASE_URL}/espace-membre/mon-espace",
        "web_base_url": settings.WEB_BASE_URL,
        "year": timezone.now().year,
    }
    html  = render_to_string("emails/payment_reminder.html", ctx)
    plain = (
        f"Bonjour{' ' + first_name if first_name else ''},\n\n"
        "Votre cotisation mensuelle est en attente. "
        "Réglez-la depuis votre espace pour conserver votre accès.\n\n"
        f"{settings.WEB_BASE_URL}/espace-membre/mon-espace"
    )
    msg = EmailMultiAlternatives(
        subject="ZOLA ASHÉ — Rappel de cotisation",
        body=plain,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=False)
    return f"reminder sent: {user_id}"

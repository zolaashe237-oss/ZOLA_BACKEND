"""Tâches asynchrones admin — rapport financier mensuel (RG-41)."""
from config.celery import app


@app.task
def monthly_financial_report():
    """Récapitulatif des paiements du mois écoulé, envoyé à l'admin (RG-41, 1er du mois 06h)."""
    from datetime import timedelta

    from django.conf import settings
    from django.core.mail import EmailMultiAlternatives
    from django.db.models import Count, Sum
    from django.template.loader import render_to_string
    from django.utils import timezone

    from apps.billing.models import Payment, PaymentStatus

    now = timezone.now()
    first_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_end = first_this_month - timedelta(seconds=1)
    last_month_start = last_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    qs = Payment.objects.filter(
        status=PaymentStatus.VALIDE,
        paid_at__gte=last_month_start,
        paid_at__lte=last_month_end,
    )
    total = qs.aggregate(t=Sum("amount"))["t"] or 0
    by_type = list(qs.values("type").annotate(n=Count("id"), montant=Sum("amount")))

    month_label = last_month_start.strftime("%m/%Y")

    ctx = {
        "month_label": month_label,
        "total": total,
        "by_type": by_type,
        "year": now.year,
    }
    html = render_to_string("emails/monthly_report.html", ctx)

    lignes = "\n".join(
        f"  - {r['type']} : {r['n']} paiements, {r['montant']} FCFA" for r in by_type
    )
    plain = (
        f"Rapport financier — {month_label}\n\n"
        f"Total encaissé : {total} FCFA\n"
        f"Détail par type :\n{lignes or '  (aucun paiement)'}\n"
    )

    msg = EmailMultiAlternatives(
        subject=f"ZOLA ASHÉ — Rapport financier {month_label}",
        body=plain,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[settings.DEFAULT_FROM_EMAIL],
    )
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=True)
    return f"monthly_financial_report: {total} FCFA"


# TODO: exports CSV asynchrones pour gros volumes, statistiques lourdes.
@app.task
def ping():
    return "pong"

@app.task
def send_block_notification(user_id: int, reason: str):
    """Envoie une notification de blocage par email et WhatsApp (via template)."""
    from django.conf import settings
    from django.core.mail import send_mail
    from apps.accounts.models import User
    from apps.notifications.whatsapp import WhatsAppService

    user = User.objects.filter(id=user_id).first()
    if not user:
        return "User not found"
        
    subject = "ZOLA ASHÉ - Votre compte a été bloqué"
    message = f"Bonjour {user.full_name},\n\nVotre compte a été bloqué pour la raison suivante : {reason}.\n\nVeuillez nous contacter pour plus d'informations."
    
    send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=True)
    
    if user.phone:
        service = WhatsAppService()
        service.send_template_message(
            phone_number=user.phone,
            template_slug="block_notification",
            variables={"reason": reason},
        )
        
    return f"Block notification sent to {user.email}"

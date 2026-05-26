"""Tâches asynchrones admin — rapport financier mensuel (RG-41)."""
from config.celery import app


@app.task
def monthly_financial_report():
    """Récapitulatif des paiements du mois écoulé, envoyé à l'admin (RG-41, 1er du mois 06h)."""
    from datetime import timedelta

    from django.conf import settings
    from django.core.mail import send_mail
    from django.db.models import Count, Sum
    from django.utils import timezone

    from apps.billing.models import Payment, PaymentStatus

    now = timezone.now()
    first_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_end = first_this_month - timedelta(seconds=1)
    last_month_start = last_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    qs = Payment.objects.filter(status=PaymentStatus.VALIDE,
                                paid_at__gte=last_month_start, paid_at__lte=last_month_end)
    total = qs.aggregate(t=Sum("amount"))["t"] or 0
    by_type = qs.values("type").annotate(n=Count("id"), montant=Sum("amount"))

    lignes = "\n".join(f"  - {r['type']} : {r['n']} paiements, {r['montant']} FCFA" for r in by_type)
    body = (
        f"Rapport financier — {last_month_start.strftime('%m/%Y')}\n\n"
        f"Total encaissé : {total} FCFA\n"
        f"Détail par type :\n{lignes or '  (aucun paiement)'}\n"
    )
    send_mail(
        subject=f"ZOLA ASHÉ — Rapport financier {last_month_start.strftime('%m/%Y')}",
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[settings.DEFAULT_FROM_EMAIL],
        fail_silently=True,
    )
    return f"monthly_financial_report: {total} FCFA"


# TODO: exports CSV asynchrones pour gros volumes, statistiques lourdes.
@app.task
def ping():
    return "pong"

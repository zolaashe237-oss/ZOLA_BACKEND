"""Tâches Celery — Mémoires autobiographiques."""
import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMessage

logger = logging.getLogger("memoir")


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_memoir_to_admin(self, draft_id: int) -> None:
    """Génère le .docx du mémoire et l'envoie à l'adresse éditoriale."""
    from .models import MemoirDraft
    from .services import generate_memoir_docx

    try:
        draft = MemoirDraft.objects.select_related("user").get(pk=draft_id)
    except MemoirDraft.DoesNotExist:
        logger.error("memoir.send_to_admin: draft %s introuvable", draft_id)
        return

    user = draft.user
    member_name = getattr(user, "full_name", None) or user.email

    admin_email = getattr(settings, "MEMOIR_ADMIN_EMAIL", "editions@zola-ashe.com")

    if getattr(settings, "EMAIL_MOCK", True):
        logger.info(
            "memoir.send_to_admin [MOCK] draft=%s member=%s → %s (email non envoyé)",
            draft_id, member_name, admin_email,
        )
        return

    try:
        docx_bytes = generate_memoir_docx(draft)
    except Exception as exc:
        logger.exception("memoir.send_to_admin: génération .docx échouée draft=%s", draft_id)
        raise self.retry(exc=exc)

    filename = f"memoire_{member_name.replace(' ', '_')}_{draft_id}.docx"

    body = (
        f"Bonjour,\n\n"
        f"Un nouveau mémoire autobiographique vient d'être soumis sur ZOLA ASHÉ.\n\n"
        f"Membre : {member_name}\n"
        f"Email  : {user.email}\n"
    )
    if getattr(user, "phone", None):
        body += f"Tél.   : {user.phone}\n"
    if getattr(user, "country", None):
        body += f"Pays   : {user.country}\n"
    if draft.submitted_at:
        body += f"Soumis le : {draft.submitted_at.strftime('%d/%m/%Y à %H:%M')}\n"

    body += (
        "\nLe document Word complet est joint à cet email.\n\n"
        "Bonne lecture,\n"
        "— Système automatique ZOLA ASHÉ"
    )

    try:
        email = EmailMessage(
            subject=f"[Mémoire] Nouvelle soumission — {member_name}",
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[admin_email],
            reply_to=[user.email],
        )
        email.attach(filename, docx_bytes,
                     "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        email.send(fail_silently=False)
        logger.info("memoir.send_to_admin: email envoyé draft=%s → %s", draft_id, admin_email)
    except Exception as exc:
        logger.exception("memoir.send_to_admin: envoi email échoué draft=%s", draft_id)
        raise self.retry(exc=exc)

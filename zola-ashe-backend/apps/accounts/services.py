"""Logique d'authentification : OTP et anti-brute-force (CDC §3.3, §7.1)."""
import secrets

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.utils import timezone

from .models import EmailOTP, User, UserStatus


# ─── Suppression de compte RGPD (droit à l'effacement, art. 17) ─────────────

def anonymize_account(user: User, reason: str = "") -> None:
    """Anonymise le compte du membre (droit à l'effacement, RGPD art. 17).

    On **anonymise** plutôt qu'on ne supprime physiquement : les paiements sont
    en rétention légale (comptabilité) et la FK est `PROTECT`. On efface donc les
    données personnelles (e-mail, nom, photo, mot de passe), on désactive le
    compte, on clôture l'adhésion et on masque les contenus communautaires. Les
    paiements subsistent, dépersonnalisés. Opération journalisée à l'audit.
    """
    from apps.audit.models import AuditAction
    from apps.audit.services import record
    from apps.billing.services import close_subscription
    from apps.community.models import Comment, Post

    # Clôture de l'adhésion active (si présente) — ignore l'absence d'adhésion.
    try:
        close_subscription(user, reason="Suppression de compte (RGPD)")
    except ValueError:
        pass

    # Masque les contenus personnels (publications, commentaires).
    Post.objects.filter(author=user, active=True).update(active=False)
    Comment.objects.filter(author=user, active=True).update(active=False)

    # Trace d'audit AVANT anonymisation (réfère l'id, sans PII dans le payload).
    record(user, AuditAction.DELETE_ACCOUNT, target_type="User", target_id=user.id, reason=reason)

    # Anonymisation des données personnelles.
    if user.photo:
        user.photo.delete(save=False)
    user.email = f"deleted-{user.id}@anonymized.invalid"
    user.full_name = "Compte supprimé"
    user.photo = None
    user.email_verified = False
    user.is_active = False
    user.set_unusable_password()
    user.status = UserStatus.BLOQUE
    user.status_changed_at = timezone.now()
    user.save()


# ─── OTP de vérification email ──────────────────────────────────────────────

def generate_otp(user: User) -> str:
    """Crée un OTP à 6 chiffres, le stocke hashé, et renvoie le code en clair.

    Le clair n'est renvoyé que pour l'envoi par email — jamais persisté.
    Les anciens OTP non consommés de l'utilisateur sont invalidés.
    """
    EmailOTP.objects.filter(user=user, consumed=False).update(consumed=True)
    code = f"{secrets.randbelow(1_000_000):06d}"
    EmailOTP.objects.create(
        user=user,
        code_hash=make_password(code),
        expires_at=timezone.now() + timezone.timedelta(minutes=settings.OTP_TTL_MINUTES),
    )
    return code


def verify_otp(user: User, code: str) -> tuple[bool, str]:
    """Vérifie un OTP. Renvoie (succès, message)."""
    otp = EmailOTP.objects.filter(user=user, consumed=False).order_by("-created_at").first()
    if otp is None or not otp.is_valid():
        return False, "Code expiré ou inexistant. Demandez un nouveau code."
    if otp.attempts >= settings.OTP_MAX_ATTEMPTS:
        otp.consumed = True
        otp.save(update_fields=["consumed"])
        return False, "Trop de tentatives. Demandez un nouveau code."

    if not check_password(code, otp.code_hash):
        otp.attempts += 1
        otp.save(update_fields=["attempts"])
        restantes = settings.OTP_MAX_ATTEMPTS - otp.attempts
        return False, f"Code incorrect. Tentatives restantes : {restantes}."

    otp.consumed = True
    otp.save(update_fields=["consumed"])
    return True, "Code validé."


# ─── Anti-brute-force connexion (Redis) ─────────────────────────────────────

def _attempts_key(identifier: str) -> str:
    return f"login_attempts:{identifier.lower()}"


def is_locked(identifier: str) -> bool:
    return cache.get(_attempts_key(identifier), 0) >= settings.LOGIN_MAX_ATTEMPTS


def register_failed_login(identifier: str) -> None:
    key = _attempts_key(identifier)
    attempts = cache.get(key, 0) + 1
    cache.set(key, attempts, timeout=settings.LOGIN_LOCKOUT_MINUTES * 60)


def reset_login_attempts(identifier: str) -> None:
    cache.delete(_attempts_key(identifier))

"""Services du système de parrainage."""
import secrets
import string

from django.db.models import Sum
from django.utils import timezone


def _generate_unique_code() -> str:
    """Génère un code de parrainage alphanumérique unique (8 chars, maj)."""
    from apps.accounts.models import User
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(30):
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not User.objects.filter(referral_code=code).exists():
            return code
    return secrets.token_hex(4).upper()


def ensure_referral_code(user) -> str:
    """Retourne le code de parrainage du membre, en le créant si nécessaire."""
    if not user.referral_code:
        user.referral_code = _generate_unique_code()
        user.save(update_fields=["referral_code"])
    return user.referral_code


def register_referral(referral_code: str, new_user) -> bool:
    """
    Enregistre un parrainage PENDING lors de l'inscription avec un code.
    Supporte :
      - Code exact (ex: ZA0001, 8AB3CD21)
      - Format ZA{id} (ex: ZA0001 -> utilisateur ID 1)
      - ID numérique direct (ex: 1 -> utilisateur ID 1)
      - Email du parrain
    Retourne True si le parrainage est créé, False sinon.
    """
    if not referral_code:
        return False
    import re
    import logging
    logger = logging.getLogger(__name__)
    from apps.accounts.models import User
    from .models import Referral, AffiliateConfig

    code = str(referral_code).strip()
    if not code:
        return False

    config = AffiliateConfig.get()
    if config and not config.is_active:
        logger.warning("Programme d'affiliation inactif, parrainage ignoré pour code=%s", code)
        return False

    referrer = None

    # 1) Recherche directe par referral_code (insensible à la casse)
    referrer = (User.objects
                .filter(referral_code__iexact=code)
                .exclude(id=new_user.id)
                .first())

    # 2) Recherche par format ZA{id} (ex: ZA0001, ZA01, ZA1)
    if not referrer:
        m = re.match(r"^ZA0*(\d+)$", code, re.IGNORECASE)
        if m:
            user_id = int(m.group(1))
            referrer = User.objects.filter(id=user_id).exclude(id=new_user.id).first()

    # 3) Recherche par ID numérique direct
    if not referrer and code.isdigit():
        user_id = int(code)
        referrer = User.objects.filter(id=user_id).exclude(id=new_user.id).first()

    # 4) Recherche par email exact
    if not referrer and "@" in code:
        referrer = User.objects.filter(email__iexact=code).exclude(id=new_user.id).first()

    if not referrer:
        logger.warning("Parrain introuvable pour le code '%s' (nouvel utilisateur: %s)", code, new_user.email)
        return False

    # Assure que le parrain a un referral_code défini
    if not referrer.referral_code:
        referrer.referral_code = f"ZA{referrer.id:04d}"
        referrer.save(update_fields=["referral_code"])

    if Referral.objects.filter(referred=new_user).exists():
        logger.info("Un parrainage existe déjà pour l'utilisateur %s", new_user.email)
        return False

    ref = Referral.objects.create(referrer=referrer, referred=new_user)
    logger.info(
        "Parrainage ENREGISTRÉ : ID=%s, parrain=%s (id=%s, code=%s), filleul=%s (id=%s)",
        ref.id, referrer.email, referrer.id, referrer.referral_code, new_user.email, new_user.id,
    )
    return True


def validate_referral(user) -> None:
    """
    Valide le parrainage d'un filleul lors de son premier paiement abonnement.
    Appelé depuis billing.services.activate_paid_payment.
    """
    import logging
    logger = logging.getLogger(__name__)
    from .models import Referral, ReferralStatus, AffiliateConfig

    try:
        referral = Referral.objects.get(referred=user, status=ReferralStatus.PENDING)
    except Referral.DoesNotExist:
        return

    config = AffiliateConfig.get()
    commission = config.commission_amount
    referral.commission   = commission
    referral.status       = ReferralStatus.VALIDATED
    referral.validated_at = timezone.now()
    referral.save(update_fields=["commission", "status", "validated_at"])

    logger.info(
        "Parrainage VALIDÉ : parrain=%s (id=%s, +%s FCFA), filleul=%s (id=%s)",
        referral.referrer.email, referral.referrer.id, commission, user.email, user.id,
    )

    try:
        from apps.notifications.models import Notification, NotifType
        Notification.objects.create(
            user=referral.referrer,
            type=NotifType.PAIEMENT,
            title="Commission de parrainage gagnée !",
            body=f"Félicitations ! Votre filleul {user.full_name} a souscrit son abonnement. Un gain de {commission:,} FCFA a été crédité sur votre solde de parrainage.".replace(",", " "),
        )
    except Exception:
        pass


def get_referral_stats(user) -> dict:
    """Statistiques d'affiliation pour un membre connecté."""
    from .models import Referral, ReferralStatus, AffiliateConfig

    qs = Referral.objects.filter(referrer=user)
    validated_qs  = qs.filter(status__in=[ReferralStatus.VALIDATED, ReferralStatus.PAID])
    paid_qs       = qs.filter(status=ReferralStatus.PAID)

    total_earned  = validated_qs.aggregate(t=Sum("commission"))["t"] or 0
    paid_amount   = paid_qs.aggregate(t=Sum("commission"))["t"] or 0
    balance       = total_earned - paid_amount

    config = AffiliateConfig.get()
    code   = ensure_referral_code(user)

    return {
        "referral_code":      code,
        "commission_amount":  config.commission_amount,
        "min_withdrawal":     config.min_withdrawal,
        "whatsapp_number":    config.whatsapp_number,
        "is_active":          config.is_active,
        "total_referrals":    qs.count(),
        "pending_referrals":  qs.filter(status=ReferralStatus.PENDING).count(),
        "validated_referrals":qs.filter(status=ReferralStatus.VALIDATED).count(),
        "paid_referrals":     qs.filter(status=ReferralStatus.PAID).count(),
        "total_earned":       total_earned,
        "paid_amount":        paid_amount,
        "balance":            balance,
        "can_withdraw":       balance >= config.min_withdrawal,
    }

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
    Retourne True si le parrainage est créé, False sinon.
    """
    if not referral_code:
        return False
    from apps.accounts.models import User
    from .models import Referral, AffiliateConfig

    config = AffiliateConfig.get()
    if not config.is_active:
        return False

    referrer = (User.objects
                .filter(referral_code=referral_code)
                .exclude(id=new_user.id)
                .first())
    if not referrer:
        return False

    if Referral.objects.filter(referred=new_user).exists():
        return False

    Referral.objects.create(referrer=referrer, referred=new_user)
    return True


def validate_referral(user) -> None:
    """
    Valide le parrainage d'un filleul lors de son premier paiement abonnement.
    Appelé depuis billing.services.activate_paid_payment.
    """
    from .models import Referral, ReferralStatus, AffiliateConfig
    try:
        referral = Referral.objects.get(referred=user, status=ReferralStatus.PENDING)
    except Referral.DoesNotExist:
        return

    config = AffiliateConfig.get()
    referral.commission   = config.commission_amount
    referral.status       = ReferralStatus.VALIDATED
    referral.validated_at = timezone.now()
    referral.save(update_fields=["commission", "status", "validated_at"])


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

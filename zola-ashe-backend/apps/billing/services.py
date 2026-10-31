"""Services d'adhésion, de paiement et de contrôle d'accès.

Modèle du livret : un **droit d'inscription** unique ouvre l'adhésion (`MEMBRE`,
permanente) et passe le membre ACTIF ; la **cotisation mensuelle** maintient
l'accès (RESTREINT au-delà du délai de grâce) ; le **don** est facultatif et
sans effet sur l'accès. Importé par `content`/`community` pour l'accès, et par
les vues/webhook billing pour l'initiation et l'activation des paiements.
"""
import logging
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User, UserStatus

from . import swinmo
from .models import (
    FormationPurchase,
    Payment,
    PaymentStatus,
    PaymentType,
    Subscription,
    SubscriptionPlan,
    SubscriptionType,
)

logger = logging.getLogger(__name__)

def is_member(user) -> bool:
    """Le membre a-t-il réglé son droit d'inscription (adhésion active) ?"""
    return Subscription.objects.filter(
        user=user, type=SubscriptionType.MEMBRE, active=True).exists()



def has_subscription_access(user, sub_type: str) -> bool:
    """Le membre détient-il l'accès via ce type d'abonnement ?

    Un seul type existe (`MEMBRE`) : l'accès au contenu réservé exige un membre
    ACTIF (adhérent dont la cotisation est à jour). BLOQUÉ n'a aucun accès.
    """
    if user.status == UserStatus.BLOQUE:
        return False
    if sub_type == SubscriptionType.MEMBRE:
        return user.status == UserStatus.ACTIF
    return False


def purchased_formation_ids(user) -> set[int]:
    """Formations achetées à l'unité par le membre (mémorisé sur l'objet user, par requête)."""
    if not getattr(user, "is_authenticated", False):
        return set()
    cached = getattr(user, "_purchased_formation_ids", None)
    if cached is None:
        cached = set(FormationPurchase.objects.filter(user=user).values_list("formation_id", flat=True))
        user._purchased_formation_ids = cached
    return cached


def has_purchased_formation(user, formation) -> bool:
    return formation.pk in purchased_formation_ids(user)


def forget_purchased_formations(user) -> None:
    """Invalide le cache des achats porté par cette instance utilisateur."""
    user.__dict__.pop("_purchased_formation_ids", None)


# ─── Catalogue des paiements (kind → tarif/produit Swinmo) ──────────────────

@dataclass(frozen=True)
class Plan:
    kind: str
    product_id: str
    amount: int
    payment_type: str
    subscription_type: str | None


def resolve_plan(kind: str) -> Plan:
    """Traduit un `kind` d'achat en tarif, produit Swinmo et types métier.

    Les prix sont lus depuis SubscriptionPlan en DB si le plan est actif ;
    sinon, les valeurs de settings servent de repli.
    """
    STATIC: dict[str, Plan] = {
        "INSCRIPTION": Plan("INSCRIPTION", settings.SWINMO_PRODUCT_INSCRIPTION,
                            settings.PRICE_INSCRIPTION, PaymentType.INSCRIPTION,
                            SubscriptionType.MEMBRE),
        "COTISATION":  Plan("COTISATION",  getattr(settings, "SWINMO_PRODUCT_INSCRIPTION_TRANCHE", settings.SWINMO_PRODUCT_COTISATION),
                            settings.PRICE_COTISATION, PaymentType.COTISATION, None),
        "ANNUEL":      Plan("ANNUEL",
                            getattr(settings, "SWINMO_PRODUCT_ANNUEL", "") or settings.SWINMO_PRODUCT_INSCRIPTION,
                            settings.PRICE_ANNUEL, PaymentType.ANNUEL, None),
        "BRANCHE_FEMME":  Plan("BRANCHE_FEMME",
                               getattr(settings, "SWINMO_PRODUCT_BRANCHE_FEMME", ""),
                               25000, PaymentType.BRANCHE_FEMME, None),
        "BRANCHE_ENFANT": Plan("BRANCHE_ENFANT",
                               getattr(settings, "SWINMO_PRODUCT_BRANCHE_ENFANT", ""),
                               20000, PaymentType.BRANCHE_ENFANT, None),
        "DON": Plan("DON", settings.SWINMO_PRODUCT_DON, settings.DON_MIN_AMOUNT,
                    PaymentType.DON, None),
    }
    if kind not in STATIC:
        raise ValueError(f"Type d'achat inconnu : {kind}")
    base = STATIC[kind]
    try:
        db = SubscriptionPlan.objects.get(kind=kind, is_active=True)
        amount = db.tranche_amount if (db.billing == "TRANCHES" and db.tranche_amount) else db.price_total
        return Plan(base.kind, base.product_id, amount, base.payment_type, base.subscription_type)
    except SubscriptionPlan.DoesNotExist:
        return base


# ─── Initiation d'un paiement (création du lien Swinmo) ─────────────────────

def initiate_payment(user, kind: str, amount: int | None = None, formation=None) -> dict:
    """Crée un PAYMENTS EN_ATTENTE et le lien de paiement Swinmo.

    Notre `reference` interne (UUID) est stockée dans `swinmo_ref` et renvoyée
    dans le `metadata` Swinmo → réconciliation et idempotence au webhook (RG-08).
    Pour un don, `amount` (libre) prime sur le montant plancher du plan. Pour un
    achat de formation, le montant est le prix de la `formation` fixé par l'admin.
    """
    if kind == "FORMATION":
        product_id = (getattr(settings, "SWINMO_PRODUCT_FORMATION", "")
                      or settings.SWINMO_PRODUCT_INSCRIPTION)
        plan = Plan("FORMATION", product_id, formation.price, PaymentType.FORMATION, None)
    else:
        plan = resolve_plan(kind)
    effective_amount = amount if (kind == "DON" and amount) else plan.amount
    reference = uuid4().hex

    payment = Payment.objects.create(
        user=user,
        type=plan.payment_type,
        status=PaymentStatus.EN_ATTENTE,
        amount=effective_amount,
        swinmo_ref=reference,
        formation=formation if kind == "FORMATION" else None,
    )

    # Mode MOCK (aucune clé Swinmo) : on renvoie une page de paiement simulé du
    # front au lieu d'appeler l'API externe → le parcours reste complet en local.
    if settings.SWINMO_MOCK:
        checkout_url = (f"{settings.WEB_BASE_URL}/paiement/simulation"
                        f"?ref={reference}&kind={kind}&amount={effective_amount}")
        return {"payment_id": payment.id, "reference": reference,
                "amount": effective_amount, "checkout_url": checkout_url, "mock": True}

    metadata = {"reference": reference, "user_id": user.id, "kind": kind}
    if kind == "FORMATION":
        metadata["formation_id"] = formation.id
    
    logger.info(f"[Swinmo] Initiation paiement pour user={user.id}, kind={kind}, amount={effective_amount}")
    
    try:
        response = swinmo.create_checkout_link(plan.product_id, effective_amount, user.email, metadata)
        logger.info(f"[Swinmo] Succès : {response}")
        return {
            "payment_id": payment.id,
            "reference": reference,
            "amount": effective_amount,
            "checkout_url": swinmo.extract_checkout_url(response),
        }
    except Exception as e:
        logger.error(f"[Swinmo] Échec requête : {str(e)}")
        raise


def confirm_mock_payment(user, reference: str) -> str:
    """Confirme un paiement simulé (mode MOCK uniquement). Active le paiement
    en attente de l'utilisateur, comme le ferait le webhook Swinmo."""
    if not settings.SWINMO_MOCK:
        raise ValueError("Confirmation simulée indisponible (Swinmo configuré).")
    payment = Payment.objects.filter(
        user=user, swinmo_ref=reference, status=PaymentStatus.EN_ATTENTE).first()
    if payment is None:
        raise ValueError("Paiement introuvable ou déjà traité.")
    # Même instance que l'appelant : les effets (statut, cache des achats) lui sont visibles.
    payment.user = user
    # kind == type (INSCRIPTION / COTISATION / DON) dans le modèle du livret.
    activate_paid_payment(payment, payment.type)
    return payment.type


# ─── Échéance d'accès (durée mensuelle cumulable) ───────────────────────────

def close_subscription(user, reason: str = "") -> Subscription:
    """Clôture volontaire de l'adhésion du membre (résiliation immédiate, RG-02).

    L'adhésion active est désactivée et son échéance figée à aujourd'hui ; le
    membre repasse RESTREINT (les jours déjà réglés ne sont pas remboursés). Une
    nouvelle inscription rouvre une adhésion. Action journalisée à l'audit.
    """
    from apps.audit.models import AuditAction
    from apps.audit.services import record

    sub = Subscription.objects.filter(
        user=user, type=SubscriptionType.MEMBRE, active=True).first()
    if sub is None:
        raise ValueError("Aucune adhésion active à clôturer.")

    sub.active = False
    sub.end = timezone.now().date()        # échéance figée à aujourd'hui
    sub.save(update_fields=["active", "end"])
    if user.status == UserStatus.ACTIF:
        user.set_status(UserStatus.RESTREINT)
    record(user, AuditAction.CLOSE_SUBSCRIPTION, target_type="Subscription",
           target_id=sub.id, reason=reason)
    return sub


def extend_subscription(sub: Subscription, days: int) -> None:
    """Prolonge l'échéance d'accès de `days` jours, de façon **cumulable**.

    Si l'abonnement est encore valide, on prolonge depuis l'échéance courante
    (payer en avance ajoute du temps) ; sinon on repart d'aujourd'hui.
    """
    today = timezone.now().date()
    base = sub.end if (sub.end and sub.end >= today) else today
    sub.end = base + timedelta(days=days)
    sub.active = True
    sub.save(update_fields=["end", "active"])


# ─── Activation après paiement confirmé ─────────────────────────────────────

@transaction.atomic
def activate_paid_payment(payment: Payment, kind: str) -> None:
    """Marque le paiement VALIDE et applique les effets métier selon le `kind`."""
    payment.status = PaymentStatus.VALIDE
    user = payment.user
    period = settings.COTISATION_PERIOD_DAYS

    if not user.email_verified:
        user.email_verified = True
        user.save(update_fields=["email_verified"])

    if kind == "INSCRIPTION":
        # Ouvre (ou réactive) l'adhésion et inclut la 1ʳᵉ période d'accès.
        sub, _ = Subscription.objects.get_or_create(
            user=user, type=SubscriptionType.MEMBRE, active=True,
            defaults={"start": timezone.now().date(), "end": None},
        )
        extend_subscription(sub, period)        # 1ʳᵉ période incluse
        payment.subscription = sub
        user.set_status(UserStatus.ACTIF)
        levels = list(user.access_levels or [])
        if "MEMBRE" not in levels:
            levels.append("MEMBRE")
            user.access_levels = levels
            user.save(update_fields=["access_levels"])

    elif kind == "COTISATION":
        # La cotisation prolonge l'échéance d'un adhérent et (re)active l'accès.
        # 1er paiement d'un non-adhérent (offre « Accès mensuel » choisie à
        # l'inscription) : il ouvre l'adhésion. Sans cela le paiement était encaissé
        # mais le compte restait RESTREINT.
        sub, _ = Subscription.objects.get_or_create(
            user=user, type=SubscriptionType.MEMBRE, active=True,
            defaults={"start": timezone.now().date(), "end": None},
        )
        extend_subscription(sub, period)
        payment.subscription = sub
        if user.status == UserStatus.RESTREINT:
            user.set_status(UserStatus.ACTIF)
        levels = list(user.access_levels or [])
        if "MEMBRE" not in levels:
            levels.append("MEMBRE")
            user.access_levels = levels
            user.save(update_fields=["access_levels"])

    elif kind == "ANNUEL":
        # Cotisation annuelle : prolonge l'échéance de 12 périodes mensuelles
        # (par défaut 360 j) et (re)active l'accès si RESTREINT.
        # Si le membre n'a pas encore d'adhésion active (premier achat annuel à l'inscription),
        # on la crée automatiquement.
        sub, _ = Subscription.objects.get_or_create(
            user=user, type=SubscriptionType.MEMBRE, active=True,
            defaults={"start": timezone.now().date(), "end": None},
        )
        extend_subscription(sub, 12 * period)
        payment.subscription = sub
        if user.status != UserStatus.ACTIF:
            user.set_status(UserStatus.ACTIF)

    elif kind == "DON":
        pass  # facultatif, aucun effet sur l'accès

    elif kind == "FORMATION":
        # Achat à l'unité : accès permanent à cette seule formation.
        if payment.formation_id:
            FormationPurchase.objects.get_or_create(
                user=user, formation_id=payment.formation_id, defaults={"payment": payment})
            forget_purchased_formations(user)

    elif kind == "BRANCHE_FEMME":
        levels = list(user.access_levels or [])
        if "FEMME" not in levels:
            levels.append("FEMME")
            user.access_levels = levels
            user.save(update_fields=["access_levels"])

    elif kind == "BRANCHE_ENFANT":
        levels = list(user.access_levels or [])
        if "ENFANT" not in levels:
            levels.append("ENFANT")
            user.access_levels = levels
            user.save(update_fields=["access_levels"])

    payment.save()
    _send_confirmation(user.email, kind, full_name=user.full_name, amount=payment.amount)
    _create_payment_notification(user, kind, payment.amount)
    # Parrainage : valide la commission du parrain au premier abonnement du filleul.
    if kind not in ("DON", "FORMATION"):
        try:
            from apps.affiliate.services import validate_referral
            validate_referral(user)
        except Exception:
            pass


def _send_confirmation(email: str, kind: str,
                        full_name: str = "", amount: int | None = None) -> None:
    from .tasks import send_confirmation_email
    send_confirmation_email.delay(email, kind, full_name, amount)


def _create_payment_notification(user, kind: str, amount: int) -> None:
    try:
        from apps.notifications.models import Notification, NotifType
        labels = {
            "INSCRIPTION":    "Droit d'adhésion",
            "COTISATION":     "Cotisation mensuelle",
            "ANNUEL":         "Cotisation annuelle",
            "DON":            "Don enregistré",
            "BRANCHE_FEMME":  "Branche Femme",
            "BRANCHE_ENFANT": "Branche Enfant",
            "FORMATION":      "Achat de formation",
        }
        label = labels.get(kind, kind)
        Notification.objects.create(
            user=user,
            type=NotifType.PAIEMENT,
            title=f"Paiement confirmé — {label}",
            body=f"Votre paiement de {amount:,} FCFA a été validé.".replace(",", " "),
        )
    except Exception:
        pass


# ─── Traitement d'un webhook Swinmo (RG-01, RG-08) ──────────────────────────

def process_webhook_event(event: str, data: dict) -> str:
    """Traite un événement webhook déjà authentifié. Retourne un libellé d'issue.

    Idempotent : un `order.paid` rejoué sur un paiement déjà VALIDE est ignoré.
    """
    reference = data.get("reference") or (data.get("metadata") or {}).get("reference")
    payment = None
    matched_via_fallback = False
    matched_via_api = False

    # Si pas de référence directe dans le payload, essayer de la récupérer via l'API Swinmo
    order_id = data.get("orderId")
    if not reference and order_id:
        try:
            logger.info(f"[Swinmo] Webhook sans metadata. Récupération des détails de la commande {order_id} via l'API...")
            order_details = swinmo.get_order_details(order_id)
            if order_details.get("success"):
                metadata = order_details.get("data", {}).get("metadata") or {}
                reference = metadata.get("reference")
                if reference:
                    logger.info(f"[Swinmo] Référence trouvée via API Swinmo: {reference}")
                    matched_via_api = True
        except Exception as e:
            logger.warning(f"[Swinmo] Échec récupération commande via API Swinmo pour {order_id}: {e}")

    if reference:
        payment = Payment.objects.filter(swinmo_ref=reference).first()

    if payment is None:
        return "unknown-payment"

    if event == "order.paid":
        if payment.status == PaymentStatus.VALIDE:
            return "duplicate"            # RG-08 : déjà traité
        
        # Associer la référence Swinmo de l'ordre si elle n'est pas encore enregistrée
        order_id = data.get("orderId")
        if order_id and (not payment.swinmo_ref or matched_via_fallback or matched_via_api):
            payment.swinmo_ref = order_id

        # Récupérer le "kind" soit des metadata, soit directement du type de paiement résolu
        kind = (data.get("metadata") or {}).get("kind") or payment.type
        activate_paid_payment(payment, kind)
        return "activated"

    if event == "order.failed":
        if payment.status != PaymentStatus.VALIDE:
            payment.status = PaymentStatus.ECHOUE
            payment.save(update_fields=["status"])
        return "failed"

    return "ignored-event"


# ─── Activation / désactivation globale de la cotisation mensuelle ──────────

def suspend_monthly_requirement() -> int:
    """Cotisation désactivée : réactive les adhérents restreints pour échéance dépassée.

    Seuls les membres RESTREINT dont l'adhésion MEMBRE est active mais échue sont
    concernés (un retard de cotisation) ; les non-adhérents et les BLOQUÉ ne
    bougent pas. Renvoie le nombre de membres réactivés.
    """
    today = timezone.now().date()
    expired = Subscription.objects.filter(
        type=SubscriptionType.MEMBRE, active=True, end__lt=today).values("user_id")
    users = User.objects.filter(role=Role.MEMBER, status=UserStatus.RESTREINT, id__in=expired)
    count = 0
    for user in users:
        user.set_status(UserStatus.ACTIF)
        count += 1
    return count


# Délai laissé aux membres pour régler leur cotisation quand elle est réactivée
# (≥ 7 j pour qu'ils reçoivent les rappels J-7/J-3/J-1).
MONTHLY_RESUME_NOTICE_DAYS = 7


def resume_monthly_requirement() -> int:
    """Cotisation réactivée : repousse les échéances dépassées à J+7.

    Pendant la désactivation, aucune cotisation n'était exigée : sans ce report,
    le cron restreindrait dès le lendemain tous les membres dont l'échéance est
    passée. Renvoie le nombre d'adhésions repoussées.
    """
    new_end = timezone.now().date() + timedelta(days=MONTHLY_RESUME_NOTICE_DAYS)
    return Subscription.objects.filter(
        type=SubscriptionType.MEMBRE, active=True, end__lt=new_end).update(end=new_end)


# ─── Cron quotidien des statuts (RG-02, RG-03) ──────────────────────────────

def _membership(user):
    """Adhésion MEMBRE active de l'utilisateur (porte l'échéance d'accès)."""
    return Subscription.objects.filter(
        user=user, type=SubscriptionType.MEMBRE, active=True).first()


def run_daily_status_check() -> dict:
    """Recalcule les statuts membres selon l'échéance d'accès et envoie les rappels.

    Pour chaque adhérent ACTIF : si l'échéance (`Subscription.end`) est dépassée
    au-delà du délai de grâce → RESTREINT ; sinon, à l'approche de l'échéance
    (J-7/J-3/J-1), rappel de cotisation. Un ACTIF forcé par l'admin dans les
    dernières 24h n'est pas modifié (exception RG-02).
    """
    from apps.accounts.features import monthly_subscription_enabled
    from .tasks import send_payment_reminder

    # Cotisation mensuelle désactivée : l'échéance d'accès n'est plus appliquée.
    if not monthly_subscription_enabled():
        return {"restricted": 0, "reminders": 0, "skipped": "monthly_subscription_disabled"}

    now = timezone.now()
    today = now.date()
    restricted, reminders = 0, 0
    grace = settings.COTISATION_GRACE_DAYS

    for user in User.objects.filter(status=UserStatus.ACTIF, role=Role.MEMBER):
        # Exception RG-02 : ne pas écraser un ACTIF forcé manuellement < 24h.
        if user.status_changed_at >= now - timedelta(hours=24):
            continue
        sub = _membership(user)
        if sub is None:
            continue  # pas d'adhésion : rien à recalculer
        if sub.end is None:
            continue  # adhésion legacy sans échéance : on ne touche pas

        days_overdue = (today - sub.end).days       # > 0 si échéance passée
        if days_overdue > grace:
            user.set_status(UserStatus.RESTREINT)
            restricted += 1
        else:
            days_left = (sub.end - today).days       # ≥ 0 avant échéance
            if days_left in (7, 3, 1):
                send_payment_reminder.delay(user.id)
                reminders += 1

    return {"restricted": restricted, "reminders": reminders}

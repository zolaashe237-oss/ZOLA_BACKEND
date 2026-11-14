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
    LibraryPdfPurchase,
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


def purchased_library_pdf_ids(user) -> set[int]:
    """Livres achetés à l'unité par le membre (mémorisé sur l'objet user, par requête)."""
    if not getattr(user, "is_authenticated", False):
        return set()
    cached = getattr(user, "_purchased_library_pdf_ids", None)
    if cached is None:
        cached = set(LibraryPdfPurchase.objects.filter(user=user).values_list("library_pdf_id", flat=True))
        user._purchased_library_pdf_ids = cached
    return cached


def has_purchased_library_pdf(user, pdf) -> bool:
    return pdf.pk in purchased_library_pdf_ids(user)


def forget_purchased_formations(user) -> None:
    """Invalide le cache des achats (formations et livres) porté par cette instance utilisateur."""
    user.__dict__.pop("_purchased_formation_ids", None)
    user.__dict__.pop("_purchased_library_pdf_ids", None)


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

def initiate_payment(user, kind: str, amount: int | None = None, formation=None,
                     library_pdf=None) -> dict:
    """Crée un PAYMENTS EN_ATTENTE et le lien de paiement Swinmo.

    Notre `reference` interne (UUID) est stockée dans `swinmo_ref` et renvoyée
    dans le `metadata` Swinmo → réconciliation et idempotence au webhook (RG-08).
    Pour un don, `amount` (libre) prime sur le montant plancher du plan. Pour un
    achat de formation ou de livre, le montant est le prix fixé par l'admin.
    """
    if kind in ("FORMATION", "LIVRE"):
        product_id = (getattr(settings, "SWINMO_PRODUCT_FORMATION", "")
                      or settings.SWINMO_PRODUCT_INSCRIPTION)
        item = formation if kind == "FORMATION" else library_pdf
        plan = Plan(kind, product_id, item.price, PaymentType(kind), None)
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
        library_pdf=library_pdf if kind == "LIVRE" else None,
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
    elif kind == "LIVRE":
        metadata["library_pdf_id"] = library_pdf.id
    
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

    elif kind == "LIVRE":
        # Achat à l'unité : accès permanent à ce seul livre.
        if payment.library_pdf_id:
            LibraryPdfPurchase.objects.get_or_create(
                user=user, library_pdf_id=payment.library_pdf_id, defaults={"payment": payment})
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
    if kind not in ("DON", "FORMATION", "LIVRE"):
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
            "LIVRE":          "Achat de livre",
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


# ─── Application d'une vérification Swinmo (webhook, retour, réconciliation) ──

def apply_provider_verification(payment: Payment, verification) -> str:
    """Applique le résultat de `verify_transaction_with_provider` au paiement.

    Verrou de ligne + transaction : deux webhooks simultanés ne créditent qu'une fois.
    Un paiement VALIDE est final (jamais repassé en échec ou en attente). Le type de
    paiement vient de la base, jamais de la requête.
    """
    with transaction.atomic():
        locked = Payment.objects.select_for_update().select_related("user").get(pk=payment.pk)
        if locked.status == PaymentStatus.VALIDE:
            return "duplicate"
        outcome = verification.outcome
        if verification.provider_tx_id:
            locked.provider_tx_id = verification.provider_tx_id

        if outcome == "paid":
            locked.paid_amount = verification.paid_amount
            locked.currency = verification.currency or locked.currency
            locked.verified_at = timezone.now()
            activate_paid_payment(locked, locked.type)
            return "activated"

        if outcome == "mismatch":
            locked.status = PaymentStatus.AMOUNT_MISMATCH
            locked.paid_amount = verification.paid_amount
            locked.verified_at = timezone.now()
            locked.save()
            logger.error("[Swinmo] ALERTE montant non conforme : paiement=%s user=%s — %s",
                         locked.pk, locked.user_id, verification.reason)
            return "amount-mismatch"

        if outcome == "failed":
            if locked.status != PaymentStatus.ECHOUE:
                locked.status = PaymentStatus.ECHOUE
                locked.save()
                _notify_payment_failed(locked)
            return "failed"

        if outcome == "unverifiable":
            logger.warning("[Swinmo] Vérification impossible : paiement=%s — %s",
                           locked.pk, verification.reason)
        if verification.provider_tx_id:
            locked.save(update_fields=["provider_tx_id"])
        return outcome  # « pending » ou « unverifiable » : rien d'accordé


def verify_and_apply(payment: Payment, provider_tx_id_hint: str = "") -> str:
    """Vérifie chez Swinmo puis applique — point d'entrée unique."""
    from .verification import verify_transaction_with_provider
    return apply_provider_verification(payment, verify_transaction_with_provider(payment, provider_tx_id_hint))


def _notify_payment_failed(payment: Payment) -> None:
    try:
        from apps.notifications.models import Notification, NotifType
        Notification.objects.create(
            user=payment.user, type=NotifType.PAIEMENT,
            title="Paiement non abouti",
            body=(f"Votre paiement de {payment.amount:,} FCFA n'a pas abouti. "
                  "Vous pouvez réessayer depuis votre espace.").replace(",", " "),
        )
    except Exception:
        logger.exception("Notification d'échec de paiement impossible (paiement=%s)", payment.pk)


# ─── Réconciliation : paiements restés en attente (webhook perdu) ────────────

RECONCILE_MIN_AGE = timedelta(minutes=3)   # laisse le temps au webhook d'arriver
RECONCILE_BATCH = 200


def _reconcile_interval(age: timedelta) -> int:
    """Secondes entre deux vérifications d'un même paiement : plus il est ancien,
    plus on espace (limite les appels à l'API Swinmo)."""
    if age < timedelta(hours=1):
        return 0                # à chaque passage du job (toutes les 10 min)
    if age < timedelta(days=1):
        return 3600
    return 86400


def run_payment_reconciliation(now=None) -> dict:
    """Revérifie chez Swinmo les paiements EN_ATTENTE (Swinmo ne renvoie pas un webhook
    perdu). Même vérification centralisée que le webhook et la page de retour."""
    from collections import Counter

    from django.core.cache import cache

    if settings.SWINMO_MOCK:
        return {"skipped": "mock"}
    now = now or timezone.now()
    pending = (Payment.objects
               .filter(status=PaymentStatus.EN_ATTENTE, swinmo_ref__isnull=False,
                       paid_at__lte=now - RECONCILE_MIN_AGE,
                       paid_at__gte=now - timedelta(days=settings.PAYMENT_FOLLOWUP_MAX_DAYS))
               .select_related("user").order_by("paid_at")[:RECONCILE_BATCH])
    outcomes = Counter()
    for payment in pending:
        interval = _reconcile_interval(now - payment.paid_at)
        if interval and not cache.add(f"billing:reconcile:{payment.pk}", 1, interval):
            outcomes["not-due"] += 1
            continue
        try:
            outcomes[verify_and_apply(payment)] += 1
        except Exception:
            logger.exception("Réconciliation impossible (paiement=%s)", payment.pk)
            outcomes["error"] += 1
    return dict(outcomes)


# ─── Relances des paiements abandonnés ou échoués ───────────────────────────

# Délai après la création du paiement pour la 1re, 2e… relance (5 au maximum).
REMINDER_SCHEDULE = (timedelta(minutes=5), timedelta(hours=1), timedelta(days=1),
                     timedelta(days=3), timedelta(days=7))
# Les dons ne sont pas relancés ; un remboursement n'est pas un paiement à reprendre.
NOT_REMINDED_TYPES = (PaymentType.DON, PaymentType.REMBOURSEMENT)
MEMBERSHIP_TYPES = (PaymentType.INSCRIPTION, PaymentType.COTISATION, PaymentType.ANNUEL)


def _reminder_obsolete(payment: Payment) -> bool:
    """Plus rien à relancer : le membre a payé autrement ou a relancé un paiement lui-même."""
    from apps.accounts.features import monthly_subscription_enabled
    same_item = Payment.objects.filter(user_id=payment.user_id, type=payment.type,
                                       formation_id=payment.formation_id,
                                       library_pdf_id=payment.library_pdf_id)
    if same_item.filter(paid_at__gt=payment.paid_at).exists():
        return True   # nouvelle tentative (relancée à son tour) ou paiement plus récent
    if same_item.filter(status=PaymentStatus.VALIDE).exists() and payment.type not in MEMBERSHIP_TYPES:
        return True   # contenu déjà acheté / branche déjà payée
    user = payment.user
    if payment.type in MEMBERSHIP_TYPES and user.status == UserStatus.ACTIF:
        return True   # accès déjà à jour (autre formule payée, validation admin…)
    if payment.type == PaymentType.COTISATION and not monthly_subscription_enabled():
        return True
    branch = {PaymentType.BRANCHE_FEMME: "FEMME", PaymentType.BRANCHE_ENFANT: "ENFANT"}.get(payment.type)
    if branch and branch in (user.access_levels or []):
        return True
    if payment.type == PaymentType.FORMATION and payment.formation_id and \
            FormationPurchase.objects.filter(user=user, formation_id=payment.formation_id).exists():
        return True
    if payment.type == PaymentType.LIVRE and payment.library_pdf_id and \
            LibraryPdfPurchase.objects.filter(user=user, library_pdf_id=payment.library_pdf_id).exists():
        return True
    return False


def run_unpaid_reminders(now=None) -> dict:
    """Relance (email + notification) les paiements en ligne abandonnés ou échoués selon
    REMINDER_SCHEDULE, pendant au plus PAYMENT_FOLLOWUP_MAX_DAYS. Arrêt dès que le
    paiement aboutit ; compteur et date de dernière relance stockés (pas de doublon)."""
    from django.db.models import F

    from .tasks import send_unpaid_payment_reminder

    now = now or timezone.now()
    candidates = (Payment.objects
                  .filter(status__in=(PaymentStatus.EN_ATTENTE, PaymentStatus.ECHOUE),
                          swinmo_ref__isnull=False, reminder_count__lt=len(REMINDER_SCHEDULE),
                          paid_at__gte=now - timedelta(days=settings.PAYMENT_FOLLOWUP_MAX_DAYS))
                  .exclude(type__in=NOT_REMINDED_TYPES)
                  .select_related("user").order_by("paid_at"))
    sent = stopped = 0
    for payment in candidates:
        if now < payment.paid_at + REMINDER_SCHEDULE[payment.reminder_count]:
            continue
        if _reminder_obsolete(payment):
            # On clôt le suivi de ce paiement : plus aucune relance.
            Payment.objects.filter(pk=payment.pk).update(reminder_count=len(REMINDER_SCHEDULE))
            stopped += 1
            continue
        # Mise à jour conditionnelle : si un autre worker vient de relancer, on s'abstient.
        claimed = Payment.objects.filter(pk=payment.pk, reminder_count=payment.reminder_count).update(
            reminder_count=F("reminder_count") + 1, last_reminder_at=now)
        if not claimed:
            continue
        _notify_unpaid(payment)
        send_unpaid_payment_reminder.delay(payment.pk)
        sent += 1
    return {"sent": sent, "stopped": stopped}


PAYMENT_LABELS = {
    "INSCRIPTION": "votre adhésion", "COTISATION": "votre cotisation mensuelle",
    "ANNUEL": "votre cotisation annuelle", "BRANCHE_FEMME": "l'accès Branche Femme",
    "BRANCHE_ENFANT": "l'accès Branche Enfant", "FORMATION": "votre formation",
    "LIVRE": "votre livre",
}


def unpaid_payment_label(payment: Payment) -> str:
    item = payment.formation or payment.library_pdf
    base = PAYMENT_LABELS.get(payment.type, "votre paiement")
    return f"{base} « {item.title} »" if item else base


def unpaid_payment_url(payment: Payment) -> str:
    """Page où reprendre le paiement (la session Swinmo d'origine a pu expirer)."""
    path = {
        PaymentType.FORMATION: f"/espace-membre/formations/{payment.formation_id}",
        PaymentType.LIVRE: "/espace-membre/bibliotheque",
        PaymentType.COTISATION: "/espace-membre/transactions",
    }.get(payment.type, "/inscription?step=3")
    return f"{settings.WEB_BASE_URL}{path}"


def _notify_unpaid(payment: Payment) -> None:
    try:
        from apps.notifications.models import Notification, NotifType
        Notification.objects.create(
            user=payment.user, type=NotifType.PAIEMENT,
            title="Paiement à finaliser",
            body=(f"Votre paiement pour {unpaid_payment_label(payment)} n'est pas finalisé. "
                  "Reprenez-le en un clic depuis votre espace."),
        )
    except Exception:
        logger.exception("Notification de relance impossible (paiement=%s)", payment.pk)


# ─── Traitement d'un webhook Swinmo (RG-01, RG-08) ──────────────────────────

def find_webhook_payment(data: dict) -> Payment | None:
    """Paiement visé par un webhook : par notre référence, sinon par l'identifiant de
    commande Swinmo (déjà connu, ou relu chez Swinmo avec notre clé)."""
    reference = data.get("reference") or (data.get("metadata") or {}).get("reference")
    order_id = str(data.get("orderId") or "")
    payment = Payment.objects.filter(swinmo_ref=reference).first() if reference else None
    if payment is None and order_id:
        payment = Payment.objects.filter(provider_tx_id=order_id).first()
    if payment is None and order_id:
        try:
            details = swinmo.get_order_details(order_id)
            ref = ((details.get("data") or {}).get("metadata") or {}).get("reference")
            if ref:
                payment = Payment.objects.filter(swinmo_ref=ref).first()
        except swinmo.SwinmoError as exc:
            logger.warning("[Swinmo] Commande %s illisible : %s", order_id, exc)
    return payment


def process_webhook_event(event: str, data: dict) -> str:
    """Traite un webhook déjà authentifié (signature). Retourne un libellé d'issue.

    Le corps ne décide de rien : on retrouve NOTRE paiement, puis on relit la commande
    chez Swinmo (GET avec notre clé secrète) ; seules ces données font foi.
    """
    payment = find_webhook_payment(data)
    if payment is None:
        logger.warning("[Swinmo] Webhook pour une transaction inconnue : event=%s ref=%s order=%s",
                       event, data.get("reference") or (data.get("metadata") or {}).get("reference"),
                       data.get("orderId"))
        return "unknown-payment"
    if event not in ("order.paid", "order.failed"):
        return "ignored-event"
    return verify_and_apply(payment, str(data.get("orderId") or ""))


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

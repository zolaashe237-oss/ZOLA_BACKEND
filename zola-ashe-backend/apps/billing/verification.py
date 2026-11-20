"""Vérification d'une transaction auprès de Swinmo — seule source de vérité.

Le corps d'un webhook n'est jamais cru sur parole, même signé (le secret peut
fuiter) : statut, montant, devise et référence sont relus chez Swinmo avec notre
clé secrète (`GET /api/developer/order/:orderId`). Utilisé par le webhook, la page
de retour et le job de réconciliation.
"""
import logging
from dataclasses import dataclass

from django.conf import settings

from . import swinmo

logger = logging.getLogger(__name__)

# La doc Swinmo montre « paid » (GET) et « PAID » (webhook) sans lister les autres
# valeurs : on normalise en minuscules et on reconnaît les variantes usuelles. Tout
# statut inconnu est traité comme « en attente » (jamais comme un succès).
PAID_STATUSES = {"paid", "succeeded", "success", "completed", "complete"}
FAILED_STATUSES = {"failed", "expired", "cancelled", "canceled", "rejected", "declined"}


@dataclass(frozen=True)
class ProviderVerification:
    """Résultat de la vérification chez Swinmo.

    outcome : « paid » | « failed » | « pending » | « mismatch » (montant/devise non
    conforme) | « unverifiable » (commande illisible ou ne correspondant pas à la nôtre).
    """
    outcome: str
    provider_tx_id: str = ""
    paid_amount: int | None = None
    currency: str = ""
    reason: str = ""


def _order_data(response) -> dict:
    """Commande dans la réponse Swinmo (`{"success": …, "data": {…}}` ou à plat)."""
    if not isinstance(response, dict):
        return {}
    data = response.get("data")
    return data if isinstance(data, dict) else response


def _find_order(payment, provider_tx_id_hint: str = "") -> dict | None:
    """Commande Swinmo de ce paiement : par son identifiant Swinmo s'il est connu, sinon
    parmi les commandes de l'email du membre (webhook perdu, retour sans identifiant)."""
    order_id = provider_tx_id_hint or payment.provider_tx_id
    if order_id:
        order = _order_data(swinmo.get_order_details(order_id))
        return {**order, "orderId": order.get("orderId") or order.get("id") or order_id} if order else None
    response = swinmo.list_orders_by_email(payment.user.email)
    data = response.get("data") if isinstance(response, dict) else response
    if isinstance(data, dict):
        data = data.get("orders", [])
    orders = [o for o in (data if isinstance(data, list) else []) if isinstance(o, dict)]
    for order in orders:
        if (order.get("metadata") or {}).get("reference") == payment.swinmo_ref:
            return {**order, "orderId": order.get("orderId") or order.get("id") or ""}
    # Swinmo ne renvoie pas toujours notre référence en lecture : repli sur l'unique commande
    # de même montant dont l'identifiant n'est rattaché à aucun autre paiement.
    candidates = [o for o in orders
                  if _to_int(o.get("amount")) == payment.amount
                  and not (o.get("metadata") or {}).get("reference")
                  and _order_id_free(payment, str(o.get("orderId") or o.get("id") or ""))]
    if len(candidates) == 1:
        o = candidates[0]
        return {**o, "orderId": o.get("orderId") or o.get("id") or ""}
    return None


def _order_id_free(payment, order_id: str) -> bool:
    """L'identifiant de commande Swinmo n'est rattaché à aucun AUTRE paiement."""
    from .models import Payment
    return bool(order_id) and not Payment.objects.filter(provider_tx_id=order_id).exclude(pk=payment.pk).exists()


def _binds_without_reference(payment, order: dict, order_id: str) -> str:
    """Rattachement d'une commande qui ne porte pas notre référence (la relecture Swinmo ne
    renvoie pas toujours `metadata.reference`). Retourne une raison de refus, ou « » si OK.
    Garde-fous : identifiant de commande jamais utilisé par un autre paiement, et e-mail de
    la commande identique à celui du membre quand Swinmo le fournit."""
    if not _order_id_free(payment, order_id):
        return "identifiant de commande absent ou déjà rattaché à un autre paiement"
    email = order.get("customerEmail") or order.get("email")
    if email and str(email).strip().lower() != payment.user.email.strip().lower():
        return "e-mail de la commande Swinmo ≠ e-mail du membre"
    if not email:
        logger.warning("[Swinmo] commande %s sans e-mail ni référence : rattachée par identifiant seul", order_id)
    return ""


def _to_int(value) -> int | None:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def verify_transaction_with_provider(payment, provider_tx_id_hint: str = "",
                                     webhook: dict | None = None) -> ProviderVerification:
    """Relit la transaction chez Swinmo et la confronte à notre paiement en base."""
    try:
        order = _find_order(payment, provider_tx_id_hint)
    except swinmo.SwinmoError as exc:
        return ProviderVerification("unverifiable", reason=f"Swinmo injoignable : {exc}")
    if not order:
        return ProviderVerification("pending", reason="commande introuvable chez Swinmo")

    order_id = str(order.get("orderId") or "")
    # Le webhook signé (data) porte lui aussi montant, devise, e-mail et `order.priceSource` ;
    # la relecture GET, elle, ne contient ni montant ni metadata. On complète l'une par l'autre.
    webhook = webhook if isinstance(webhook, dict) else {}
    wh_order = webhook.get("order") if isinstance(webhook.get("order"), dict) else {}
    webhook_amount = _to_int(webhook.get("amount") if webhook.get("amount") is not None else wh_order.get("amount"))
    wh_email = webhook.get("customerEmail") or wh_order.get("customerEmail")
    if wh_email and not (order.get("customerEmail") or order.get("email")):
        order = {**order, "customerEmail": wh_email}
    wh_currency = webhook.get("currency") or wh_order.get("currency")
    if wh_currency and not order.get("currency"):
        order = {**order, "currency": wh_currency}
    # `priceSource` = d'où vient le prix : « developer_session » = montant fixé par NOTRE
    # serveur. Toute autre origine (achat direct en boutique au prix de référence) est refusée.
    price_source = wh_order.get("priceSource")
    if price_source and price_source != "developer_session":
        return ProviderVerification("mismatch", order_id, webhook_amount, "",
                                    reason=f"prix issu de « {price_source} » et non de notre session de paiement")
    # Concordance : la commande doit porter NOTRE référence interne.
    reference = (order.get("metadata") or {}).get("reference")
    if reference is not None and reference != payment.swinmo_ref:
        return ProviderVerification(
            "unverifiable", order_id,
            reason=f"référence Swinmo {reference!r} ≠ référence interne {payment.swinmo_ref!r}")
    if reference is None:
        refusal = _binds_without_reference(payment, order, order_id)
        if refusal:
            return ProviderVerification("unverifiable", order_id, reason=refusal)

    status = str(order.get("status") or "").strip().lower()
    if status in FAILED_STATUSES:
        return ProviderVerification("failed", order_id, reason=f"statut Swinmo « {status} »")
    if status not in PAID_STATUSES:
        return ProviderVerification("pending", order_id, reason=f"statut Swinmo « {status or '?'} »")

    # Commande gratuite (code promo 100 %, essais) : acceptée si SWINMO_ACCEPT_FREE_ORDERS,
    # sans contrôle de montant. Le rattachement à notre paiement reste exigé (ci-dessus).
    is_free = (str(wh_order.get("gateway") or "").upper() == "FREE"
               or str(wh_order.get("paymentMethod") or "").upper() == "FREE"
               or str(webhook.get("transactionId") or "").upper().startswith("FREE-"))
    if is_free and settings.SWINMO_ACCEPT_FREE_ORDERS:
        logger.warning("[Swinmo] commande GRATUITE acceptée (paiement=%s, commande=%s)", payment.pk, order_id)
        currency = str(order.get("currency") or payment.currency).upper()
        return ProviderVerification("paid", order_id, 0, currency)

    paid_amount = _to_int(order.get("amount"))
    if paid_amount is None:
        # La relecture Swinmo ne renvoie pas toujours le montant (seulement statut, devise,
        # e-mail, produit) : on retombe sur celui du webhook signé, s'il en porte un.
        paid_amount = webhook_amount
    if paid_amount is None and settings.SWINMO_ALLOW_UNVERIFIED_AMOUNT and order_id:
        # Dernier recours : commande payée, rattachée à notre paiement (référence signée du
        # webhook / identifiant unique + e-mail) mais montant introuvable chez Swinmo.
        logger.warning("[Swinmo] montant non vérifiable chez Swinmo (paiement=%s, commande=%s) : "
                       "accepté sur statut PAID + rattachement", payment.pk, order_id)
        currency = str(order.get("currency") or payment.currency).upper()
        if currency != payment.currency:
            return ProviderVerification("mismatch", order_id, None, currency,
                                        reason=f"devise {currency} ≠ {payment.currency} attendue")
        return ProviderVerification("paid", order_id, None, currency)
    # Devise : celle de la boutique (XAF) si Swinmo ne la précise pas. Une carte débitée
    # en USD reste créditée dans la devise de la boutique (montant de la session).
    currency = str(order.get("currency") or payment.currency).upper()
    if paid_amount is None:
        return ProviderVerification("unverifiable", order_id, reason="montant absent de la réponse Swinmo")
    if currency != payment.currency:
        return ProviderVerification("mismatch", order_id, paid_amount, currency,
                                    reason=f"devise {currency} ≠ {payment.currency} attendue")
    # Montant payé ≥ montant attendu (des frais côté client restent acceptés).
    # Pas de coupons sur la plateforme : un montant inférieur est toujours refusé.
    if paid_amount < payment.amount:
        return ProviderVerification("mismatch", order_id, paid_amount, currency,
                                    reason=f"montant payé {paid_amount} < {payment.amount} attendu")
    return ProviderVerification("paid", order_id, paid_amount, currency)

"""Client de l'API de paiement Swinmo (https://www.swinmo.shop/developers).

- Création d'un lien de paiement : POST /api/developer/checkout-link
  (auth Bearer `SWINMO_SECRET_KEY`).
- Vérification des webhooks : HMAC-SHA256 du corps BRUT, en-tête
  `x-swinmo-signature` (hex). On compare sur les octets reçus tels quels
  (et non une re-sérialisation) pour éviter toute divergence de formatage.
"""
import hashlib
import hmac

import requests
from django.conf import settings


class SwinmoError(Exception):
    """Erreur d'appel à l'API Swinmo."""


def create_checkout_link(product_id: str, amount: int, email: str,
                         metadata: dict, *, timeout: int = 15) -> dict:
    """Crée un lien de paiement Swinmo et renvoie la réponse JSON.

    `amount` est en sous-unité (XAF n'a pas de centime → valeur FCFA directe).
    `metadata` nous est intégralement renvoyé par le webhook (on y place notre
    référence interne pour réconcilier le paiement).
    """
    url = f"{settings.SWINMO_API_URL.rstrip('/')}/api/developer/checkout-link"
    payload = {
        "productId": product_id,
        "amount": amount,
        "email": email,
        "metadata": metadata,
        "returnUrl": settings.SWINMO_RETURN_URL,
        "cancelUrl": settings.SWINMO_CANCEL_URL,
    }
    try:
        resp = requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {settings.SWINMO_SECRET_KEY}"},
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        raise SwinmoError(f"Échec de création du lien Swinmo : {exc}") from exc


def extract_checkout_url(response: dict) -> str:
    """Récupère l'URL de paiement quel que soit le nom de champ employé."""
    for key in ("url", "checkoutUrl", "checkout_url", "link", "paymentUrl"):
        if response.get(key):
            return response[key]
    data = response.get("data") or {}
    for key in ("url", "checkoutUrl", "link"):
        if data.get(key):
            return data[key]
    return ""


def verify_signature(raw_body: bytes, signature: str | None) -> bool:
    """Valide la signature HMAC-SHA256 d'un webhook (comparaison constante)."""
    if not signature or not settings.SWINMO_WEBHOOK_SECRET:
        return False
    expected = hmac.new(
        settings.SWINMO_WEBHOOK_SECRET.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())

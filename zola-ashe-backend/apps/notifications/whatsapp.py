import logging
import requests
from django.conf import settings

logger = logging.getLogger("notifications")


def _format_whatsapp_number(phone_number: str) -> str:
    """
    Formate un numéro au format E.164 attendu par Twilio (ex: 'whatsapp:+237699000000').
    """
    cleaned = phone_number.strip().replace("whatsapp:", "").strip()
    if not cleaned.startswith("+"):
        cleaned = f"+{cleaned}"
    return f"whatsapp:{cleaned}"


def _send_via_twilio(phone_number: str, message: str) -> bool:
    account_sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
    auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
    from_number = getattr(settings, "TWILIO_WHATSAPP_NUMBER", "")

    if not account_sid or not auth_token or not from_number:
        logger.error("Identifiants Twilio manquants dans les paramètres.")
        return False

    to_number = _format_whatsapp_number(phone_number)
    from_num = _format_whatsapp_number(from_number)

    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    data = {
        "From": from_num,
        "To": to_number,
        "Body": message,
    }

    try:
        response = requests.post(
            url, data=data, auth=(account_sid, auth_token), timeout=10
        )
        if response.status_code in [200, 201]:
            logger.info("Message WhatsApp envoyé via Twilio à %s", to_number)
            return True

        logger.error("Erreur Twilio %d: %s", response.status_code, response.text)
        return False
    except requests.RequestException as exc:
        logger.exception("Échec de la requête réseau Twilio: %s", exc)
        return False


def _send_via_evolution_api(phone_number: str, message: str) -> bool:
    base_url = getattr(settings, "EVOLUTION_API_URL", "").rstrip("/")
    api_key = getattr(settings, "EVOLUTION_API_KEY", "")
    instance_name = getattr(settings, "EVOLUTION_INSTANCE_NAME", "")

    if not base_url or not api_key or not instance_name:
        logger.error("Identifiants Evolution API manquants dans les paramètres.")
        return False

    # Evolution API requiert le numéro sans le '+' ni le préfixe 'whatsapp:'
    clean_phone = phone_number.replace("+", "").replace("whatsapp:", "").strip()
    url = f"{base_url}/message/sendText/{instance_name}"
    headers = {
        "apikey": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "number": clean_phone,
        "text": message,
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        if response.status_code in [200, 201]:
            logger.info("Message WhatsApp envoyé via Evolution API à %s", clean_phone)
            return True

        logger.error("Erreur Evolution API %d: %s", response.status_code, response.text)
        return False
    except requests.RequestException as exc:
        logger.exception("Échec de la requête réseau Evolution API: %s", exc)
        return False


def send_whatsapp_message(phone_number: str, message: str) -> bool:
    """
    Envoie un message WhatsApp via le provider configuré (MOCK, TWILIO, EVOLUTION_API).
    """
    if not phone_number or not message.strip():
        logger.warning("Tentative d'envoi WhatsApp avec numéro ou message vide.")
        return False

    provider = getattr(settings, "WHATSAPP_PROVIDER", "MOCK").upper()

    if provider == "TWILIO":
        return _send_via_twilio(phone_number, message)
    if provider == "EVOLUTION_API":
        return _send_via_evolution_api(phone_number, message)

    logger.info("[MOCK WHATSAPP] Destinataire: %s | Message: %s", phone_number, message)
    return True

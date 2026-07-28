import logging
from abc import ABC, abstractmethod
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


def _clean_phone(phone_number: str) -> str:
    """Supprime le préfixe 'whatsapp:' et le '+' pour obtenir un numéro brut."""
    return phone_number.strip().replace("whatsapp:", "").replace("+", "").strip()


def _format_e164(phone_number: str) -> str:
    """Formate un numéro au format E.164 attendu par Twilio (ex: 'whatsapp:+237699000000')."""
    cleaned = _clean_phone(phone_number)
    if not cleaned.startswith("+"):
        cleaned = f"+{cleaned}"
    return f"whatsapp:{cleaned}"


# ─── Providers (Strategy pattern) ────────────────────────────────────────────

class WhatsAppProvider(ABC):
    """Interface commune pour tous les providers WhatsApp."""

    @abstractmethod
    def send_text(self, phone_number: str, message: str, **kwargs: Any) -> bool:
        """Envoie un message texte simple."""
        ...

    @abstractmethod
    def send_template(self, phone_number: str, template_slug: str,
                      variables: dict[str, str] | None = None, **kwargs: Any) -> bool:
        """Envoie un message via un template Twilio."""
        ...


class MockProvider(WhatsAppProvider):
    """Provider simulé pour le développement local."""

    def send_text(self, phone_number: str, message: str, **kwargs: Any) -> bool:
        logger.info("[MOCK WHATSAPP] Destinataire: %s | Message: %s", phone_number, message)
        return True

    def send_template(self, phone_number: str, template_slug: str,
                      variables: dict[str, str] | None = None, **kwargs: Any) -> bool:
        logger.info("[MOCK WHATSAPP] Template: %s | Destinataire: %s | Variables: %s",
                    template_slug, phone_number, variables or {})
        return True


class TwilioProvider(WhatsAppProvider):
    """Provider Twilio pour l'envoi de messages WhatsApp."""

    def __init__(self) -> None:
        self.account_sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
        self.auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
        self.from_number = getattr(settings, "TWILIO_WHATSAPP_NUMBER", "")

    def _check_credentials(self) -> bool:
        if not self.account_sid or not self.auth_token or not self.from_number:
            logger.error("Identifiants Twilio manquants dans les paramètres.")
            return False
        return True

    def _post(self, data: dict) -> bool:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        try:
            response = requests.post(
                url, data=data, auth=(self.account_sid, self.auth_token), timeout=10
            )
            if response.status_code in [200, 201]:
                return True
            logger.error("Erreur Twilio %d: %s", response.status_code, response.text)
            return False
        except requests.RequestException as exc:
            logger.exception("Échec de la requête réseau Twilio: %s", exc)
            return False

    def send_text(self, phone_number: str, message: str, **kwargs: Any) -> bool:
        """
        Envoi sans template — utilisable uniquement pour les réponses
        à une conversation initiée par le client (< 24h).
        """
        if not self._check_credentials():
            return False

        data = {
            "From": _format_e164(self.from_number),
            "To": _format_e164(phone_number),
            "Body": message,
        }
        success = self._post(data)
        if success:
            logger.info("Message texte WhatsApp envoyé via Twilio à %s", phone_number)
        return success

    def send_template(self, phone_number: str, template_slug: str,
                      variables: dict[str, str] | None = None, **kwargs: Any) -> bool:
        """
        Envoi via un Content Template Twilio — obligatoire pour les
        conversations initiées par le business.
        """
        if not self._check_credentials():
            return False

        # Récupération du template depuis la base
        from apps.notifications.models import WhatsAppTemplate
        try:
            tmpl = WhatsAppTemplate.objects.get(slug=template_slug, is_active=True)
        except WhatsAppTemplate.DoesNotExist:
            logger.error("Template WhatsApp '%s' introuvable ou inactif.", template_slug)
            return False

        # Construction du ContentSid ou utilisation de ContentVariables
        variables_str = ""
        content_sid = tmpl.twilio_template_sid or ""

        if variables:
            # Twilio attend une chaîne JSON pour ContentVariables
            import json
            # Les Content Variables Twilio sont indexées ({{1}}, {{2}}…)
            # On accepte un dict avec des clés numériques "1", "2"… ou nommées
            variables_str = json.dumps(variables, ensure_ascii=False)

        data = {
            "From": _format_e164(self.from_number),
            "To": _format_e164(phone_number),
            "Body": _render_template_body(tmpl.body, variables or {}),
        }

        # Si un Content SID Twilio est configuré, on utilise l'API Content
        if content_sid:
            data["ContentSid"] = content_sid
            if variables_str:
                data["ContentVariables"] = variables_str

        success = self._post(data)
        if success:
            logger.info("Message template WhatsApp envoyé via Twilio à %s (template: %s)",
                        phone_number, template_slug)
        return success


class EvolutionAPIProvider(WhatsAppProvider):
    """Provider Evolution API pour l'envoi de messages WhatsApp."""

    def __init__(self) -> None:
        self.base_url = getattr(settings, "EVOLUTION_API_URL", "").rstrip("/")
        self.api_key = getattr(settings, "EVOLUTION_API_KEY", "")
        self.instance_name = getattr(settings, "EVOLUTION_INSTANCE_NAME", "")

    def _check_credentials(self) -> bool:
        if not self.base_url or not self.api_key or not self.instance_name:
            logger.error("Identifiants Evolution API manquants dans les paramètres.")
            return False
        return True

    def send_text(self, phone_number: str, message: str, **kwargs: Any) -> bool:
        if not self._check_credentials():
            return False

        clean_phone = _clean_phone(phone_number)
        url = f"{self.base_url}/message/sendText/{self.instance_name}"
        headers = {"apikey": self.api_key, "Content-Type": "application/json"}
        payload = {"number": clean_phone, "text": message}

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

    def send_template(self, phone_number: str, template_slug: str,
                      variables: dict[str, str] | None = None, **kwargs: Any) -> bool:
        """Evolution API ne supporte pas nativement les templates Twilio.
        On envoie le corps du template avec les variables substituées."""
        from apps.notifications.models import WhatsAppTemplate
        try:
            tmpl = WhatsAppTemplate.objects.get(slug=template_slug, is_active=True)
        except WhatsAppTemplate.DoesNotExist:
            logger.error("Template WhatsApp '%s' introuvable ou inactif.", template_slug)
            return False

        body = _render_template_body(tmpl.body, variables or {})
        return self.send_text(phone_number, body)


# ─── Utilitaires ─────────────────────────────────────────────────────────────

def _render_template_body(template_body: str, variables: dict[str, str]) -> str:
    """Remplace les placeholders {{1}}, {{2}}… ou {{key}} dans le corps du template."""
    result = template_body
    for key, value in variables.items():
        result = result.replace(f"{{{{{key}}}}}", value)
    return result


_PROVIDER_MAP: dict[str, type[WhatsAppProvider]] = {
    "MOCK": MockProvider,
    "TWILIO": TwilioProvider,
    "EVOLUTION_API": EvolutionAPIProvider,
}


def _get_provider(provider_name: str | None = None) -> WhatsAppProvider:
    """Retourne l'instance du provider demandé ou celui configuré par défaut."""
    name = (provider_name or getattr(settings, "WHATSAPP_PROVIDER", "MOCK")).upper()
    provider_cls = _PROVIDER_MAP.get(name)
    if provider_cls is None:
        logger.warning("Provider WhatsApp '%s' inconnu, utilisation de MOCK.", name)
        provider_cls = MockProvider
    return provider_cls()


# ─── Service principal (Object-Oriented) ─────────────────────────────────────

class WhatsAppService:
    """Service orienté objet pour l'envoi de messages WhatsApp.

    Utilisation :
        service = WhatsAppService(provider="TWILIO")
        service.send_message("+237699000000", "Bonjour !")               # sans template
        service.send_template("+237699000000", "otp_code", {"1": "123456"})  # avec template
    """

    def __init__(self, provider: str | None = None):
        self.provider = _get_provider(provider)

    def send_message(self, phone_number: str, message: str, **kwargs: Any) -> bool:
        """Envoie un message texte simple (sans template).
        À utiliser uniquement pour répondre à une conversation initiée par le client (< 24h).
        """
        if not phone_number or not message.strip():
            logger.warning("Tentative d'envoi WhatsApp avec numéro ou message vide.")
            return False
        return self.provider.send_text(phone_number, message, **kwargs)

    def send_template_message(self, phone_number: str, template_slug: str,
                               variables: dict[str, str] | None = None, **kwargs: Any) -> bool:
        """Envoie un message via un template WhatsApp prédéfini.
        Utilisation recommandée pour les conversations initiées par le business.
        """
        if not phone_number:
            logger.warning("Tentative d'envoi WhatsApp template avec numéro vide.")
            return False
        return self.provider.send_template(phone_number, template_slug, variables, **kwargs)


# ─── Fonction de compatibilité (backward-compatible) ─────────────────────────

def send_whatsapp_message(phone_number: str, message: str) -> bool:
    """Fonction de compatibilité — utilise le provider par défaut sans template.
    Préférer ``WhatsAppService(...)`` pour les nouveaux développements.
    """
    service = WhatsAppService()
    return service.send_message(phone_number, message)

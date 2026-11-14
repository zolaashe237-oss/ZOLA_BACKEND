"""Environnement de production — durcissement sécurité (CDC §7.4)."""
from .base import *  # noqa: F401,F403

DEBUG = False

# --- Paiements : jamais de mode simulé en production -------------------------
# En base, SWINMO_MOCK vaut vrai dès que SWINMO_SECRET_KEY manque : en prod, une clé
# absente aurait permis à tout membre de valider gratuitement ses propres paiements
# via /billing/payments/mock-confirm/. Sans clé, les paiements échouent (fail-closed).
SWINMO_MOCK = False
if not SWINMO_SECRET_KEY or not SWINMO_WEBHOOK_SECRET:  # noqa: F405
    import logging as _logging
    _logging.getLogger("apps.billing").critical(
        "SWINMO_SECRET_KEY ou SWINMO_WEBHOOK_SECRET manquant : paiements et webhooks inopérants.")

# --- HTTPS / cookies sécurisés ----------------------------------------------
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")  # derrière Traefik
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# --- Logs structurés (JSON) -------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}

# Sentry (optionnel) : activé si le DSN est fourni.
SENTRY_DSN = env("SENTRY_DSN", default="")  # noqa: F405
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(dsn=SENTRY_DSN, integrations=[DjangoIntegration()], traces_sample_rate=0.1)

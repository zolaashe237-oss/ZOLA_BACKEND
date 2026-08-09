"""Vérifie que l'auth OAuth YouTube est fonctionnelle (peut refresh l'access_token).

Usage :

    python manage.py youtube_oauth_healthcheck

Sortie :
- exit 0 + message vert si tout est OK
- exit 1 + message rouge si l'auth est cassée (vars manquantes, token révoqué,
  token expiré après 7j en mode Testing, etc.)

Conçu pour être appelé depuis un cron (surveillance quotidienne) ou en
sanity-check post-déploiement.

Voir SETUP_YOUTUBE_OFFICIAL_API.md pour la configuration OAuth.
"""
from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"]


class Command(BaseCommand):
    help = "Vérifie que le refresh_token OAuth YouTube peut échanger un access_token."

    def handle(self, *args, **opts):
        client_id = getattr(settings, "YOUTUBE_OAUTH_CLIENT_ID", "")
        client_secret = getattr(settings, "YOUTUBE_OAUTH_CLIENT_SECRET", "")
        refresh_token = getattr(settings, "YOUTUBE_OAUTH_REFRESH_TOKEN", "")

        missing = [
            name for name, val in [
                ("YOUTUBE_OAUTH_CLIENT_ID", client_id),
                ("YOUTUBE_OAUTH_CLIENT_SECRET", client_secret),
                ("YOUTUBE_OAUTH_REFRESH_TOKEN", refresh_token),
            ] if not val
        ]
        if missing:
            raise CommandError(
                f"Variables OAuth manquantes dans .env : {', '.join(missing)}. "
                f"Voir SETUP_YOUTUBE_OFFICIAL_API.md."
            )

        try:
            from google.auth.transport.requests import Request
            from google.oauth2.credentials import Credentials
        except ImportError as exc:
            raise CommandError(
                "Dépendances manquantes : `pip install google-auth google-auth-oauthlib`."
            ) from exc

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=SCOPES,
        )

        try:
            creds.refresh(Request())
        except Exception as exc:
            raise CommandError(
                f"Refresh du token OAuth échoué : {exc}. "
                f"Causes fréquentes : token révoqué, ou consent screen en mode "
                f"Testing (expire après 7 jours). "
                f"Fix : relancer le bootstrap (voir SETUP_YOUTUBE_OFFICIAL_API.md)."
            )

        self.stdout.write(
            self.style.SUCCESS(
                "OK : refresh_token valide, access_token régénéré."
            )
        )
        if creds.expiry:
            self.stdout.write(
                f"     Access token expire à : {creds.expiry.isoformat()}"
            )
        self.stdout.write(
            "     Client ID utilisé : "
            f"{client_id[:20]}...{client_id[-25:] if len(client_id) > 25 else ''}"
        )

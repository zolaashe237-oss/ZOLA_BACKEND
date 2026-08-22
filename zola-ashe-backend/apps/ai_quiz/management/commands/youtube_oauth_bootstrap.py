"""Génère un refresh token OAuth 2.0 pour l'API YouTube.

Usage (une fois par environnement, sur un poste avec navigateur) :

    python manage.py youtube_oauth_bootstrap \
        --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET>

Ouvre un serveur local, redirige vers Google, capture le code de retour
puis échange contre un refresh token. Le refresh token affiché est à
copier tel quel dans `.env` (YOUTUBE_OAUTH_REFRESH_TOKEN).

Le compte OAuth utilisé pour valider doit être **propriétaire** des
vidéos YouTube dont on souhaite extraire les transcriptions —
`captions.download` refuse les vidéos tierces.

Voir `SETUP_YOUTUBE_OFFICIAL_API.md` pour la préparation GCP.
"""
from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"]


class Command(BaseCommand):
    help = "Génère un refresh token OAuth 2.0 pour l'API YouTube Data v3."

    def add_arguments(self, parser):
        parser.add_argument(
            "--client-id",
            default="",
            help="Client ID OAuth (sinon lu depuis YOUTUBE_OAUTH_CLIENT_ID).",
        )
        parser.add_argument(
            "--client-secret",
            default="",
            help="Client Secret OAuth (sinon lu depuis YOUTUBE_OAUTH_CLIENT_SECRET).",
        )
        parser.add_argument(
            "--port",
            type=int,
            default=8765,
            help="Port du redirect local (défaut : 8765).",
        )

    def handle(self, *args, **opts):
        client_id = opts["client_id"] or getattr(
            settings, "YOUTUBE_OAUTH_CLIENT_ID", ""
        )
        client_secret = opts["client_secret"] or getattr(
            settings, "YOUTUBE_OAUTH_CLIENT_SECRET", ""
        )
        port = opts["port"]

        if not client_id or not client_secret:
            raise CommandError(
                "client_id et client_secret sont requis : fournis via --client-id "
                "/ --client-secret ou renseigne YOUTUBE_OAUTH_CLIENT_ID/SECRET "
                "dans .env avant de lancer la commande."
            )

        try:
            from google_auth_oauthlib.flow import InstalledAppFlow
        except ImportError as exc:
            raise CommandError(
                "google-auth-oauthlib manquant : `pip install google-auth-oauthlib`."
            ) from exc

        client_config = {
            "installed": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [f"http://localhost:{port}/"],
            }
        }

        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)

        self.stdout.write(
            "-> Un onglet navigateur va s'ouvrir pour la connexion Google.\n"
            "  Utilise le compte YouTube propriétaire des vidéos à transcrire.\n"
        )

        credentials = flow.run_local_server(
            port=port,
            prompt="consent",
            access_type="offline",
            open_browser=True,
        )

        if not credentials.refresh_token:
            raise CommandError(
                "Google n'a pas retourné de refresh_token. Cause fréquente : "
                "le compte a déjà autorisé cette app — révoquer l'accès sur "
                "https://myaccount.google.com/permissions puis relancer."
            )

        self.stdout.write(self.style.SUCCESS("\n=== SUCCES ==="))
        self.stdout.write("Copie ces lignes dans ton `.env` :\n\n")
        self.stdout.write(f"YOUTUBE_OAUTH_CLIENT_ID={client_id}")
        self.stdout.write(f"YOUTUBE_OAUTH_CLIENT_SECRET={client_secret}")
        self.stdout.write(
            f"YOUTUBE_OAUTH_REFRESH_TOKEN={credentials.refresh_token}\n"
        )
        self.stdout.write(
            self.style.WARNING(
                "\n[WARNING] Si le consent screen GCP est encore en mode « Testing » "
                "(non publié), ce refresh_token expirera dans 7 jours. Publier "
                "l'app en « In production » sur Google Cloud Console pour "
                "obtenir un token permanent."
            )
        )

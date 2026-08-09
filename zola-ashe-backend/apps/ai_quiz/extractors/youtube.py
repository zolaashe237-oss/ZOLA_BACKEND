"""Extraction de la transcription d'une vidéo YouTube via l'API officielle.

Utilise **YouTube Data API v3** (Google) avec OAuth 2.0 (refresh token
stocké en settings). Nécessite que le compte YouTube authentifié soit
propriétaire des vidéos ciblées (ou ait été autorisé par le propriétaire)
— captions.download exige `youtube.force-ssl` et refuse les vidéos
tierces.

Configuration (voir `SETUP_YOUTUBE_OFFICIAL_API.md`) :

- `YOUTUBE_OAUTH_CLIENT_ID`
- `YOUTUBE_OAUTH_CLIENT_SECRET`
- `YOUTUBE_OAUTH_REFRESH_TOKEN`

Priorité de langue : FR → EN → première dispo. Si aucune piste n'existe
ou que l'auth manque, lève `TranscriptNotAvailable`.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger("ai_quiz")

_YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|v/|shorts/)|youtu\.be/)"
    r"(?P<id>[A-Za-z0-9_-]{11})"
)

_SRT_INDEX_RE = re.compile(r"^\d+$")
_SRT_TIMING_RE = re.compile(
    r"^\d{2}:\d{2}:\d{2}[,.]\d+\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d+"
)
_INLINE_TAG_RE = re.compile(r"</?[^>]+>")
_BRACKET_TAG_RE = re.compile(r"\[[^\]]+\]")

_DEFAULT_LANGS: tuple[str, ...] = ("fr", "fr-FR", "en", "en-US")


class TranscriptNotAvailable(RuntimeError):
    """La transcription officielle n'est pas récupérable."""


def extract_youtube_id(url_or_id: str) -> str:
    """Extrait l'ID vidéo depuis une URL YouTube (ou renvoie l'ID si fourni tel quel)."""
    if not url_or_id:
        raise ValueError("URL YouTube vide.")
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url_or_id):
        return url_or_id
    match = _YOUTUBE_ID_RE.search(url_or_id)
    if not match:
        raise ValueError(f"URL YouTube non reconnue : {url_or_id!r}")
    return match.group("id")


def extract_youtube_transcript(
    url_or_id: str,
    *,
    language_priority: tuple[str, ...] = _DEFAULT_LANGS,
) -> str:
    """Retourne la transcription concaténée d'une vidéo YouTube.

    Utilise l'API officielle Google. Le compte OAuth doit être propriétaire
    de la vidéo (ou explicitement autorisé), sinon `captions.download`
    renvoie une 403.
    """
    from django.conf import settings

    video_id = extract_youtube_id(url_or_id)
    logger.info("youtube.extract video_id=%s", video_id)

    youtube = _build_youtube_service(settings)

    caption_id, caption_lang = _pick_caption_track(
        youtube, video_id, list(language_priority)
    )
    if not caption_id:
        raise TranscriptNotAvailable(
            f"Aucune piste de sous-titres pour vidéo {video_id}."
        )

    srt = _download_caption_srt(youtube, caption_id)
    text = _srt_to_plain_text(srt)

    logger.info(
        "youtube.extract video_id=%s language=%s length=%d",
        video_id,
        caption_lang,
        len(text),
    )

    if not text:
        raise TranscriptNotAvailable("Transcription vide.")
    return text


# --- Helpers privés ---------------------------------------------------------


def _build_youtube_service(settings):
    """Construit un client YouTube Data API v3 authentifié via refresh token."""
    client_id = getattr(settings, "YOUTUBE_OAUTH_CLIENT_ID", "")
    client_secret = getattr(settings, "YOUTUBE_OAUTH_CLIENT_SECRET", "")
    refresh_token = getattr(settings, "YOUTUBE_OAUTH_REFRESH_TOKEN", "")
    if not (client_id and client_secret and refresh_token):
        raise TranscriptNotAvailable(
            "OAuth YouTube non configuré : renseigner YOUTUBE_OAUTH_CLIENT_ID/"
            "SECRET/REFRESH_TOKEN (voir SETUP_YOUTUBE_OFFICIAL_API.md)."
        )
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise TranscriptNotAvailable(
            "Dépendances manquantes : `pip install google-api-python-client "
            "google-auth google-auth-oauthlib`."
        ) from exc

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/youtube.force-ssl"],
    )
    creds.refresh(Request())
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def _pick_caption_track(
    youtube, video_id: str, language_priority: list[str]
) -> tuple[str | None, str | None]:
    """Retourne (caption_id, language) selon la priorité de langue.

    Priorité : langue explicite dans `language_priority` (order-sensitive)
    → première piste disponible (fallback).
    """
    try:
        resp = (
            youtube.captions()
            .list(part="id,snippet", videoId=video_id)
            .execute()
        )
    except Exception as exc:
        raise TranscriptNotAvailable(f"captions.list a échoué : {exc}") from exc

    items = resp.get("items") or []
    if not items:
        return None, None

    tracks = [
        {
            "id": it["id"],
            "language": (it.get("snippet") or {}).get("language", "").lower(),
            "trackKind": (it.get("snippet") or {}).get("trackKind", ""),
        }
        for it in items
    ]

    def _match(lang_target: str) -> dict | None:
        lang_target = lang_target.lower()
        for t in tracks:
            if t["language"] == lang_target:
                return t
        base = lang_target.split("-", 1)[0]
        for t in tracks:
            if t["language"].startswith(base):
                return t
        return None

    for lang in language_priority:
        found = _match(lang)
        if found:
            return found["id"], found["language"]

    fallback = tracks[0]
    return fallback["id"], fallback["language"]


def _download_caption_srt(youtube, caption_id: str) -> str:
    """Télécharge le contenu d'une piste au format SRT."""
    try:
        raw = (
            youtube.captions()
            .download(id=caption_id, tfmt="srt")
            .execute()
        )
    except Exception as exc:
        raise TranscriptNotAvailable(
            f"captions.download a échoué (id={caption_id}) : {exc}"
        ) from exc

    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)


def _srt_to_plain_text(srt: str) -> str:
    """Convertit un flux SRT (ou SBV) en texte plein.

    Filtre les lignes de séquence numérique, les timings, les tags
    inline (`<c>`, `<i>`) et les bracket tags (`[Musique]`).
    """
    lines: list[str] = []
    for raw in srt.splitlines():
        line = raw.strip()
        if not line:
            continue
        if _SRT_INDEX_RE.match(line):
            continue
        if _SRT_TIMING_RE.match(line):
            continue
        line = _INLINE_TAG_RE.sub("", line)
        line = _BRACKET_TAG_RE.sub("", line)
        line = line.strip()
        if line:
            lines.append(line)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()

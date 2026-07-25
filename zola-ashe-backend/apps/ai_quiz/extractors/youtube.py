"""Extraction de la transcription d'une vidéo YouTube.

Utilise `youtube-transcript-api` (aucune auth, endpoint public timedtext).
Priorité de langue : FR → EN → première dispo. Si aucune transcription
n'est disponible (vidéo privée, pas de captions, blocage géo), lève
`TranscriptNotAvailable` — l'admin uploadera alors le script manuellement.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger("ai_quiz")

_YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|v/|shorts/)|youtu\.be/)"
    r"(?P<id>[A-Za-z0-9_-]{11})"
)


class TranscriptNotAvailable(RuntimeError):
    """La transcription automatique n'est pas récupérable."""


def extract_youtube_id(url_or_id: str) -> str:
    """Extrait l'ID vidéo depuis une URL YouTube (ou renvoie l'ID si fourni tel quel)."""
    if not url_or_id:
        raise ValueError("URL YouTube vide.")
    # Cas où on nous passe déjà un ID brut (11 caractères).
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url_or_id):
        return url_or_id
    match = _YOUTUBE_ID_RE.search(url_or_id)
    if not match:
        raise ValueError(f"URL YouTube non reconnue : {url_or_id!r}")
    return match.group("id")


def extract_youtube_transcript(
    url_or_id: str,
    *,
    language_priority: tuple[str, ...] = ("fr", "fr-FR", "en", "en-US"),
) -> str:
    """Retourne la transcription concaténée d'une vidéo YouTube.

    Utilise l'API instance-based de `youtube-transcript-api` >= 1.0 :
    - `.list(video_id)` renvoie un `TranscriptList` itérable.
    - Priorité manuelle > auto-générée > première dispo (traduite en FR).
    - Chaque snippet a un attribut `.text`.
    """
    from youtube_transcript_api import (
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
        YouTubeTranscriptApi,
    )

    video_id = extract_youtube_id(url_or_id)
    logger.info("youtube.extract video_id=%s", video_id)

    api = YouTubeTranscriptApi()

    try:
        transcript_list = api.list(video_id)
    except TranscriptsDisabled as exc:
        raise TranscriptNotAvailable(
            "Les sous-titres sont désactivés sur cette vidéo."
        ) from exc
    except VideoUnavailable as exc:
        raise TranscriptNotAvailable(
            "Vidéo indisponible (privée, supprimée ou géo-bloquée)."
        ) from exc
    except Exception as exc:
        raise TranscriptNotAvailable(f"Erreur YouTube : {exc}") from exc

    transcript = None
    # 1) Captions manuelles dans la langue prioritaire.
    try:
        transcript = transcript_list.find_manually_created_transcript(list(language_priority))
    except NoTranscriptFound:
        pass

    # 2) Captions auto-générées dans la langue prioritaire.
    if transcript is None:
        try:
            transcript = transcript_list.find_generated_transcript(list(language_priority))
        except NoTranscriptFound:
            pass

    # 3) Première transcription dispo, traduite en français si possible.
    if transcript is None:
        try:
            first = next(iter(transcript_list))
        except StopIteration as exc:
            raise TranscriptNotAvailable("Aucune transcription disponible.") from exc
        try:
            transcript = first.translate("fr")
        except Exception:
            transcript = first

    fetched = transcript.fetch()
    # FetchedTranscript est itérable de FetchedTranscriptSnippet(text=..., start=..., duration=...)
    text = " ".join(_clean_line(snippet.text) for snippet in fetched if snippet.text)
    text = re.sub(r"\s+", " ", text).strip()

    logger.info(
        "youtube.extract video_id=%s language=%s length=%d",
        video_id,
        getattr(transcript, "language_code", "?"),
        len(text),
    )

    if not text:
        raise TranscriptNotAvailable("Transcription vide.")
    return text


def _clean_line(line: str) -> str:
    """Retire les balises [Musique], [Applaudissements], sauts de ligne."""
    line = re.sub(r"\[[^\]]+\]", "", line)
    line = line.replace("\n", " ")
    return line.strip()

"""Tâches Celery de l'app content."""
import logging

from django.conf import settings
from django.utils import timezone

from config.celery import app

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=2, default_retry_delay=120)
def import_youtube_playlist(self, playlist_id: str, formation_id: int | None = None):
    """Importe une playlist YouTube en Formation / Modules / Cours / Ressources.

    Utilise l'API YouTube Data v3 pour récupérer les items de la playlist.
    Si ``formation_id`` est fourni, les vidéos sont ajoutées à la formation
    existante. Sinon, une nouvelle formation est créée à partir du titre de
    la playlist.

    La tâche est conçue pour être longue (potentiellement N items × quotas API)
    et est donc encapsulée en Celery. Elle ne renvoie rien en cas de succès ;
    les logs tracent la progression et les erreurs.
    """
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError

    from apps.content.models import Course, Formation, Module, Resource

    api_key = getattr(settings, "YOUTUBE_API_KEY", None)
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY non configurée dans les settings.")

    try:
        youtube = build("youtube", "v3", developerKey=api_key, cache_discovery=False)
    except Exception as exc:
        logger.error("YouTube API build failed: %s", exc)
        raise self.retry(exc=exc)

    # 1. Récupération des métadonnées de la playlist
    try:
        playlist_resp = (
            youtube.playlists().list(part="snippet", id=playlist_id).execute()
        )
        if not playlist_resp.get("items"):
            raise ValueError(f"Playlist {playlist_id} introuvable.")
        playlist_title = playlist_resp["items"][0]["snippet"]["title"]
        playlist_desc = playlist_resp["items"][0]["snippet"].get("description", "")
    except HttpError as exc:
        logger.error("YouTube API error (playlist metadata): %s", exc)
        raise self.retry(exc=exc)

    # 2. Création / récupération de la Formation
    if formation_id:
        try:
            formation = Formation.objects.get(id=formation_id)
        except Formation.DoesNotExist:
            raise ValueError(f"Formation {formation_id} introuvable.")
    else:
        formation = Formation.objects.create(
            title=playlist_title[:200],
            description=playlist_desc or None,
            status="DRAFT",
        )

    # 3. Création d'un Module racine unique pour la playlist
    module = Module.objects.create(
        formation=formation,
        title=f"Playlist : {playlist_title[:200]}",
        description=playlist_desc or None,
        order=Module.objects.filter(formation=formation).count() + 1,
    )

    # 4. Pagination des items de la playlist
    next_page_token = None
    course_order = 0
    imported = 0

    while True:
        try:
            items_resp = (
                youtube.playlist_items()
                .list(
                    part="snippet",
                    playlistId=playlist_id,
                    maxResults=50,
                    pageToken=next_page_token,
                )
                .execute()
            )
        except HttpError as exc:
            logger.error("YouTube API error (playlist items): %s", exc)
            raise self.retry(exc=exc)

        for item in items_resp.get("items", []):
            snippet = item.get("snippet", {})
            video_id = snippet.get("resourceId", {}).get("videoId")
            if not video_id:
                continue

            video_title = snippet.get("title", "")
            video_desc = snippet.get("description", "")
            youtube_url = f"https://www.youtube.com/watch?v={video_id}"

            course_order += 1
            course = Course.objects.create(
                module=module,
                title=video_title[:200] or f"Vidéo {course_order}",
                description=video_desc or None,
                order=course_order,
            )
            Resource.objects.create(
                course=course,
                resource_type="VIDEO",
                title=video_title[:200] or f"Ressource {course_order}",
                video_source="YOUTUBE",
                youtube_url=youtube_url,
                order=1,
            )
            imported += 1

        next_page_token = items_resp.get("nextPageToken")
        if not next_page_token:
            break

    logger.info(
        "Playlist '%s' (%s) importée : %s vidéos → Formation #%s.",
        playlist_title, playlist_id, imported, formation.id,
    )
    return {"formation_id": formation.id, "imported": imported}


@app.task
def publish_scheduled_formations():
    """Publie les formations programmées dont l'heure de mise en ligne est atteinte.

    Programmée toutes les minutes (Celery Beat) : une formation en statut SCHEDULED
    dont `publish_at` est échu bascule automatiquement en PUBLISHED.
    """
    from .services import publish_due_formations
    return publish_due_formations()

"""Service d'import de formation depuis une playlist YouTube."""
import re
from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.db import transaction
from django.utils.text import slugify


# ── Helpers URL / durée ────────────────────────────────────────────────────────

def extract_playlist_id(url: str) -> str | None:
    """Extrait le playlistId depuis n'importe quel format d'URL YouTube."""
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    pid = qs.get("list", [None])[0]
    if pid:
        return pid
    # Format raccourci youtu.be ou embed — rare mais géré
    match = re.search(r"[&?]list=([A-Za-z0-9_-]+)", url)
    return match.group(1) if match else None


def _iso8601_to_sec(duration: str) -> int | None:
    """PT1H2M3S → 3723 secondes. Renvoie None si la durée est indisponible."""
    if not duration:
        return None
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not m:
        return None
    h  = int(m.group(1) or 0)
    mi = int(m.group(2) or 0)
    s  = int(m.group(3) or 0)
    total = h * 3600 + mi * 60 + s
    return total if total else None


def _build_client():
    """Construit le client YouTube Data API v3."""
    from googleapiclient.discovery import build  # type: ignore[import]
    key = getattr(settings, "YOUTUBE_API_KEY", "")
    if not key:
        raise ValueError(
            "YOUTUBE_API_KEY non configurée. "
            "Ajoutez-la dans votre fichier .env pour activer l'import réel."
        )
    return build("youtube", "v3", developerKey=key, cache_discovery=False)


# ── Appels YouTube API ─────────────────────────────────────────────────────────

def _best_thumb(thumbs: dict, fallback_id: str = "") -> str:
    """Meilleure miniature disponible depuis un dict thumbnails YouTube."""
    for key in ("maxres", "standard", "high", "medium", "default"):
        url = thumbs.get(key, {}).get("url")
        if url:
            return url
    return f"https://img.youtube.com/vi/{fallback_id}/mqdefault.jpg" if fallback_id else ""


def _fetch_playlist_info(yt, playlist_id: str) -> tuple[str, str]:
    """Renvoie (title, cover_url) de la playlist."""
    resp = yt.playlists().list(part="snippet", id=playlist_id).execute()
    items = resp.get("items", [])
    if not items:
        raise ValueError(f"Playlist introuvable ou privée (id : {playlist_id}).")
    snippet = items[0]["snippet"]
    return snippet["title"], _best_thumb(snippet.get("thumbnails", {}))


def _fetch_playlist_videos(yt, playlist_id: str, limit: int | None = None) -> list[dict]:
    """Récupère les items de la playlist (gestion de la pagination).
    Si limit est défini, s'arrête après avoir collecté ce nombre de vidéos.
    """
    videos, page_token = [], None
    while True:
        batch_size = min(50, limit - len(videos)) if limit else 50
        resp = yt.playlistItems().list(
            part="snippet,contentDetails",
            playlistId=playlist_id,
            maxResults=batch_size,
            pageToken=page_token,
        ).execute()
        for item in resp.get("items", []):
            snippet = item.get("snippet", {})
            if snippet.get("title") in ("Deleted video", "Private video"):
                continue
            video_id = (
                snippet.get("resourceId", {}).get("videoId")
                or item.get("contentDetails", {}).get("videoId")
            )
            if not video_id:
                continue
            videos.append({
                "video_id":      video_id,
                "title":         snippet.get("title", "Sans titre"),
                "thumbnail_url": _best_thumb(snippet.get("thumbnails", {}), video_id),
            })
            if limit and len(videos) >= limit:
                return videos
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return videos


def _fetch_durations(yt, video_ids: list[str]) -> dict[str, int | None]:
    """Récupère les durées en batch (50 ids max par appel API)."""
    durations: dict[str, int | None] = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i : i + 50]
        resp = yt.videos().list(part="contentDetails", id=",".join(batch)).execute()
        for item in resp.get("items", []):
            durations[item["id"]] = _iso8601_to_sec(
                item["contentDetails"].get("duration", "")
            )
    return durations


# ── Logique métier ─────────────────────────────────────────────────────────────

_PREVIEW_LIMIT = 50   # vidéos max affichées en aperçu (évite les timeouts)


def _get_playlist_total(yt, playlist_id: str) -> int | None:
    """Renvoie le nombre total d'items déclaré par la playlist (incluant privés)."""
    try:
        resp = yt.playlists().list(part="contentDetails", id=playlist_id).execute()
        items = resp.get("items", [])
        if items:
            return items[0]["contentDetails"].get("itemCount")
    except Exception:
        pass
    return None


def _build_preview_data(playlist_url: str, limit: int | None = _PREVIEW_LIMIT) -> dict:
    """
    Appelle l'API YouTube et renvoie les données de preview/import.
    limit=None → récupère TOUTES les vidéos (mode confirm).
    limit=N    → s'arrête à N vidéos (mode preview, plus rapide).
    """
    playlist_id = extract_playlist_id(playlist_url)
    if not playlist_id:
        raise ValueError("URL invalide — paramètre `list=` introuvable.")

    yt = _build_client()

    title, cover_url = _fetch_playlist_info(yt, playlist_id)
    videos = _fetch_playlist_videos(yt, playlist_id, limit=limit)

    if not videos:
        raise ValueError("La playlist est vide ou tous ses items sont privés/supprimés.")

    durations = _fetch_durations(yt, [v["video_id"] for v in videos])

    courses = [
        {
            "title":         v["title"],
            "youtube_url":   f"https://www.youtube.com/watch?v={v['video_id']}",
            "duration_sec":  durations.get(v["video_id"]),
            "thumbnail_url": v["thumbnail_url"],
        }
        for v in videos
    ]

    # Couverture de formation = miniature de la playlist (ou première vidéo en fallback)
    if not cover_url and courses:
        cover_url = courses[0]["thumbnail_url"]

    # Compte réel de la playlist (peut être > limit en mode preview)
    total = _get_playlist_total(yt, playlist_id) or len(courses)
    truncated = limit is not None and len(videos) >= limit and total > len(courses)

    return {
        "formation_title": title,
        "playlist_url":    playlist_url,
        "cover_url":       cover_url,
        "total_videos":    total,
        "preview_count":   len(courses),   # vidéos affichées (≤ total si tronqué)
        "truncated":       truncated,       # True si l'aperçu ne montre pas tout
        "modules": [
            {"title": "Module 1", "courses": courses},
        ],
    }


def _unique_slug(title: str) -> str:
    """Génère un slug unique pour la Formation."""
    from apps.content.models import Formation
    base = slugify(title)[:200] or "formation-yt"
    slug, n = base, 2
    while Formation.objects.filter(slug=slug).exists():
        slug = f"{base[:195]}-{n}"
        n += 1
    return slug


def _create_formation(preview: dict) -> tuple[object, int, int]:
    """
    Crée en base Formation + Modules + Courses + Resources.
    Renvoie (formation, modules_created, courses_created).
    """
    from apps.content.models import Course, Formation, Module, Resource, ResourceType, VideoSource

    with transaction.atomic():
        formation = Formation.objects.create(
            title=preview["formation_title"],
            slug=_unique_slug(preview["formation_title"]),
            status="DRAFT",
            cover_url=preview.get("cover_url", ""),
        )

        modules_created = 0
        courses_created = 0

        for order_m, module_data in enumerate(preview["modules"]):
            module = Module.objects.create(
                formation=formation,
                title=module_data["title"],
                order=order_m,
            )
            modules_created += 1

            for order_c, course_data in enumerate(module_data["courses"]):
                course = Course.objects.create(
                    module=module,
                    title=course_data["title"],
                    order=order_c,
                )
                Resource.objects.create(
                    course=course,
                    title=course_data["title"],
                    resource_type=ResourceType.VIDEO,
                    video_source=VideoSource.YOUTUBE,
                    youtube_url=course_data["youtube_url"],
                    duration_sec=course_data.get("duration_sec"),
                    thumbnail_url=course_data.get("thumbnail_url", ""),
                    order=0,
                )
                courses_created += 1

    return formation, modules_created, courses_created


# ── Points d'entrée publics ────────────────────────────────────────────────────

def preview_playlist(playlist_url: str) -> dict:
    """Renvoie la structure de preview sans rien écrire en base."""
    return _build_preview_data(playlist_url)


def import_playlist(playlist_url: str) -> dict:
    """
    Importe la playlist → crée la Formation et ses ressources en base.
    Renvoie un dict compatible avec YoutubeImportResult.
    """
    from apps.admin_api.serializers import AdminFormationSerializer

    preview = _build_preview_data(playlist_url, limit=None)   # toutes les vidéos
    formation, modules_created, courses_created = _create_formation(preview)

    return {
        "formation":       AdminFormationSerializer(formation).data,
        "modules_created": modules_created,
        "courses_created": courses_created,
    }


def import_playlist_as_chapter(playlist_url: str, formation_id: int) -> dict:
    """
    Importe la playlist comme un nouveau chapitre (Module) dans une Formation existante.
    Chaque vidéo → Course (épisode) + Resource (vidéo YouTube).
    """
    from apps.content.models import (
        Course, Formation, Module, Resource, ResourceType, VideoSource,
    )

    preview = _build_preview_data(playlist_url, limit=None)

    all_courses_data = [c for m in preview["modules"] for c in m["courses"]]
    if not all_courses_data:
        raise ValueError("La playlist ne contient aucune vidéo importable.")

    with transaction.atomic():
        formation = Formation.objects.get(pk=formation_id)
        next_order = formation.modules.filter(parent=None).count() + 1

        module = Module.objects.create(
            formation=formation,
            title=preview["formation_title"],
            order=next_order,
            parent=None,
        )

        for order_c, course_data in enumerate(all_courses_data):
            course = Course.objects.create(
                module=module,
                title=course_data["title"],
                order=order_c,
            )
            Resource.objects.create(
                course=course,
                title=course_data["title"],
                resource_type=ResourceType.VIDEO,
                video_source=VideoSource.YOUTUBE,
                youtube_url=course_data["youtube_url"],
                duration_sec=course_data.get("duration_sec"),
                thumbnail_url=course_data.get("thumbnail_url", ""),
                order=0,
            )

    return {
        "module_id":       module.id,
        "module_title":    module.title,
        "formation_id":    formation_id,
        "courses_created": len(all_courses_data),
    }

"""Services du contenu : visibilité/publication, accès formation, déblocage
arborescent (modules → cours), streaming signé et notation QCM côté serveur.

Implémente RG-16 à RG-28 sur la hiérarchie Formation → Modules → Cours → Ressources/QCM.
L'accès à une formation réservée délègue à `apps.billing.services.has_subscription_access`
via `Formation.access_subscription_types` (le type `MEMBRE` ouvre l'accès aux
membres actifs).
"""
import logging
import re

from django.conf import settings
from django.core.files.storage import default_storage
from django.db.models import Q
from django.utils import timezone

from .models import Course, Formation, FormationStatus, Module, Quiz, QuizResult

logger = logging.getLogger(__name__)

# ─── Transcription YouTube ────────────────────────────────────────────────────

_YT_ID_PATTERNS = [
    re.compile(r"[?&]v=([^&\s]+)"),
    re.compile(r"youtu\.be/([^?&\s]+)"),
    re.compile(r"/embed/([^?&\s]+)"),
    re.compile(r"/shorts/([^?&\s]+)"),
]


def _extract_youtube_id(url: str) -> str | None:
    for pattern in _YT_ID_PATTERNS:
        m = pattern.search(url)
        if m:
            return m.group(1)
    return None


def fetch_youtube_transcript(youtube_url: str) -> str:
    """Récupère la transcription d'une vidéo YouTube. Retourne '' en cas d'échec.

    Préférence : français → anglais → première langue disponible.
    Échoue silencieusement pour ne pas bloquer la sauvegarde d'une ressource.
    Compatible youtube-transcript-api >= 0.6 (API instance-based).
    """
    video_id = _extract_youtube_id(youtube_url)
    if not video_id:
        return ""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        try:
            # Tentative avec langues préférées (fr en priorité, puis en)
            transcript = api.fetch(video_id, languages=["fr", "fr-FR", "fr-CA", "en"])
        except Exception:
            # Aucune langue demandée disponible — on prend la première trouvée
            transcript_list = api.list(video_id)
            first = next(iter(transcript_list))
            transcript = first.fetch()
        # Les snippets exposent .text (>=0.6) ou ["text"] (<=0.5)
        return " ".join(
            s.text if hasattr(s, "text") else s.get("text", "")
            for s in transcript
        ).strip()
    except Exception as exc:
        logger.debug("Transcript fetch failed for %s: %s", youtube_url, exc)
        return ""


# ─── Visibilité / publication programmée ────────────────────────────────────

def visible_formations_qs():
    """Formations visibles : publiées, ou programmées dont l'heure est échue."""
    now = timezone.now()
    return Formation.objects.filter(
        Q(status=FormationStatus.PUBLISHED)
        | Q(status=FormationStatus.SCHEDULED, publish_at__lte=now)
    )


def publish_due_formations() -> int:
    """Bascule en PUBLISHED les formations programmées dont `publish_at` est atteint.

    Appelée périodiquement (Celery beat). Retourne le nombre de formations publiées.
    """
    now = timezone.now()
    due = Formation.objects.filter(status=FormationStatus.SCHEDULED, publish_at__lte=now)
    return due.update(status=FormationStatus.PUBLISHED, publish_at=None)


# ─── Streaming sécurisé (RG-17, RG-19) ──────────────────────────────────────

def generate_signed_url(key: str) -> str:
    """URL signée (MinIO/R2) valable 1h pour un média protégé, en lecture `inline`.

    Pour les documents et flux privés (PDFs bibliothèque, vidéos protégées),
    génère une URL pré-signée S3v4 avec expiration (1h) contre l'endpoint R2.
    """
    if not key:
        return ""
    if not getattr(settings, "USE_S3", False):
        try:
            return default_storage.url(key)
        except Exception as exc:
            logger.error("Échec default_storage.url (key=%s): %s", key, exc)
            return f"/media/{key.lstrip('/')}"

    import mimetypes
    import boto3
    from botocore.client import Config

    # Pour les documents privés, la signature est TOUJOURS générée contre l'endpoint R2 privé
    endpoint_url = getattr(settings, "AWS_S3_ENDPOINT_URL", None) or getattr(settings, "S3_PUBLIC_ENDPOINT_URL", None)
    if endpoint_url and not endpoint_url.startswith(("http://", "https://")):
        endpoint_url = f"https://{endpoint_url}"

    aws_access_key_id = getattr(settings, "AWS_ACCESS_KEY_ID", "")
    aws_secret_access_key = getattr(settings, "AWS_SECRET_ACCESS_KEY", "")
    bucket_name = getattr(settings, "R2_PRIVATE_BUCKET", getattr(settings, "AWS_STORAGE_BUCKET_NAME", "zola-ashe-private"))
    region_name = getattr(settings, "AWS_S3_REGION_NAME", "auto")
    expire_in = getattr(settings, "AWS_QUERYSTRING_EXPIRE", 3600)

    try:
        client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            region_name=region_name,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        params = {
            "Bucket": bucket_name,
            "Key": key.lstrip("/"),
            "ResponseContentDisposition": "inline",
        }
        mime, _ = mimetypes.guess_type(key)
        if mime:
            params["ResponseContentType"] = mime
        return client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expire_in,
        )
    except Exception as exc:
        logger.error("Échec génération URL signée S3 (key=%s): %s", key, exc)
        return f"/{bucket_name}/{key.lstrip('/')}"


def generate_public_url(key: str) -> str:
    """URL directe pour un média dans le bucket public (avatars, couvertures, images).

    Contrairement à generate_signed_url, cette fonction cible le bucket public
    (MEDIA_BUCKET / AWS_STORAGE_BUCKET_NAME) via default_storage.url().
    En production avec un domaine CDN, l'URL est permanente (sans signature).
    """
    if not key:
        return ""
    try:
        return default_storage.url(key)
    except Exception as exc:
        logger.error("Échec URL publique (key=%s): %s", key, exc)
        return f"/media/{key.lstrip('/')}"


# ─── Accès à la formation (abonnement, RG-22 / RG-10) ───────────────────────

def formation_accessible(user, formation: Formation, accessible_types=None) -> bool:
    """Le membre détient-il un abonnement ouvrant cette formation ?

    Visiteur non connecté : accessible seulement si `formation.is_public`.
    Formation publique (`access_subscription_types` vide) → accessible à tout
    membre non bloqué. Sinon, accès si le membre détient un abonnement actif de
    l'UN des types requis. BLOQUÉ n'accède à rien (RG-10).
    """
    if not getattr(user, "is_authenticated", False):
        return bool(formation.is_public)

    from apps.accounts.models import UserStatus

    if user.status == UserStatus.BLOQUE:
        return False
    required = formation.access_subscription_types or []
    if not required:
        return True  # formation publique
    if accessible_types is not None:
        return any(t in accessible_types for t in required)
    from apps.billing.services import has_subscription_access
    return any(has_subscription_access(user, t) for t in required)


# ─── Déblocage séquentiel & complétion (RG-16, RG-26, RG-28) ────────────────
#
# Complétion (remonte) :  un cours est terminé si son QCM est validé (ou absent) ;
#                         un module est terminé si tous ses cours ET sous-modules
#                         sont terminés.
# Déblocage (descend) :   un module est ouvert si son parent est terminé et ses
#                         frères précédents sont terminés ; un cours est ouvert si
#                         son module est ouvert et les cours précédents terminés.
# Prérequis inter-formation : la formation N est verrouillée tant que la formation
#                              précédente (même branche, order < N) n'est pas complétée
#                              et son quiz final n'a pas obtenu ≥ 14/20.

# Seuil de passage du quiz final pour débloquer la formation suivante
INTER_FORMATION_PASS_THRESHOLD = 14


def _course_quiz(course: Course):
    quiz = getattr(course, "quiz", None)
    return quiz if (quiz and quiz.active) else None


def course_completed(user, course: Course) -> bool:
    """Cours terminé : son QCM est validé, ou il n'a pas de QCM actif."""
    quiz = _course_quiz(course)
    if quiz is None:
        return True
    return QuizResult.objects.filter(user=user, quiz=quiz, validated=True).exists()


def formation_final_quiz_passed(user, formation: Formation) -> bool:
    """Quiz final de la formation validé avec score ≥ INTER_FORMATION_PASS_THRESHOLD.

    S'il n'y a pas de quiz final actif, la condition est considérée remplie.
    """
    quiz = getattr(formation, "final_exam", None)
    if not (quiz and quiz.active):
        return True
    return QuizResult.objects.filter(
        user=user, quiz=quiz, score__gte=INTER_FORMATION_PASS_THRESHOLD
    ).exists()


def formation_all_courses_completed(user, formation: Formation) -> bool:
    """Tous les cours de la formation sont terminés."""
    courses = Course.objects.filter(module__formation=formation)
    return all(course_completed(user, c) for c in courses)


def formation_completed(user, formation: Formation) -> bool:
    """Formation terminée : tous les cours complétés ET quiz final ≥ 14/20."""
    return (
        formation_all_courses_completed(user, formation)
        and formation_final_quiz_passed(user, formation)
    )


def formation_prerequisite_met(user, formation: Formation) -> bool:
    """Prérequis inter-formation satisfait.

    La formation est librement accessible si :
    - l'utilisateur n'est pas authentifié
    - la formation est publique (is_public=True)
    - c'est la première formation de la branche
    - la formation précédente (triée par order puis pk) est terminée

    Le pk est utilisé comme tiebreaker quand plusieurs formations partagent
    le même order (cas fréquent quand order n'a pas été configuré, = 0 par défaut).
    """
    if not getattr(user, "is_authenticated", False):
        return True
    if formation.is_public:
        return True
    prev = (
        Formation.objects.filter(
            branch=formation.branch,
            is_public=False,
        )
        .filter(
            Q(order__lt=formation.order)
            | Q(order=formation.order, pk__lt=formation.pk)
        )
        .order_by("-order", "-pk")
        .first()
    )
    if prev is None:
        return True  # première formation de la branche
    return formation_completed(user, prev)


def module_completed(user, module: Module) -> bool:
    """Module terminé : tous ses cours et tous ses sous-modules sont terminés."""
    if not all(course_completed(user, c) for c in module.courses.all()):
        return False
    return all(module_completed(user, child) for child in module.children.all())


def _previous_sibling_modules(module: Module):
    return Module.objects.filter(
        formation_id=module.formation_id, parent_id=module.parent_id, order__lt=module.order)


def module_unlocked(user, module: Module) -> bool:
    """Module ouvert si :
      - son parent (le cas échéant) est lui-même ouvert ET ses cours DIRECTS sont
        terminés (on entre dans un sous-module après les leçons du module parent —
        sans exiger l'achèvement des autres sous-modules, ce qui créerait un
        interblocage), ET
      - tous les modules frères précédents sont entièrement terminés (RG-16).
    """
    if module.parent_id is not None:
        parent = module.parent
        if not module_unlocked(user, parent):
            return False
        if not all(course_completed(user, c) for c in parent.courses.all()):
            return False
    return all(module_completed(user, prev) for prev in _previous_sibling_modules(module))


def _previous_courses(course: Course):
    return Course.objects.filter(module_id=course.module_id, order__lt=course.order)


def course_unlocked(user, course: Course) -> bool:
    """Cours ouvert si son module est ouvert et les cours précédents sont terminés."""
    if not module_unlocked(user, course.module):
        return False
    return all(course_completed(user, prev) for prev in _previous_courses(course))


def final_exam_unlocked(user, formation: Formation) -> bool:
    """Examen final ouvert quand tous les cours de la formation sont terminés."""
    courses = Course.objects.filter(module__formation=formation)
    return all(course_completed(user, c) for c in courses)


def course_state(user, course: Course, accessible: bool) -> dict:
    """État d'un cours pour un membre : verrouillage (abonnement/prérequis/quiz) + achèvement."""
    if not accessible:
        return {"locked": True, "lock_reason": "subscription", "completed": False}
    if not formation_prerequisite_met(user, course.module.formation):
        return {"locked": True, "lock_reason": "formation_prerequisite", "completed": False}
    if not course_unlocked(user, course):
        return {"locked": True, "lock_reason": "quiz", "completed": False}
    return {"locked": False, "lock_reason": None, "completed": course_completed(user, course)}


def module_state(user, module: Module, accessible: bool) -> dict:
    """État d'un module : verrouillage (abonnement/prérequis/quiz) + achèvement."""
    if not accessible:
        return {"locked": True, "lock_reason": "subscription", "completed": False}
    if not formation_prerequisite_met(user, module.formation):
        return {"locked": True, "lock_reason": "formation_prerequisite", "completed": False}
    if not module_unlocked(user, module):
        return {"locked": True, "lock_reason": "quiz", "completed": False}
    return {"locked": False, "lock_reason": None, "completed": module_completed(user, module)}


# ─── Quiz : notation serveur (RG-23 à RG-28) ────────────────────────────────

def grade_quiz(quiz: Quiz, answers: dict) -> tuple[int, int, int]:
    """Note un QCM à partir des réponses du membre, côté serveur.

    `answers` : {question_id (str|int): [choice_id, ...]}. Une question est juste
    si l'ensemble des options cochées correspond EXACTEMENT à l'ensemble des
    options correctes. Retourne (score_sur_20, nb_correctes, nb_questions).
    """
    questions = list(quiz.questions.prefetch_related("choices"))
    total = len(questions)
    if total == 0:
        return 0, 0, 0
    correct = 0
    for q in questions:
        good = {c.id for c in q.choices.all() if c.is_correct}
        given = {int(c) for c in answers.get(str(q.id), answers.get(q.id, []) or [])}
        if given == good and good:
            correct += 1
    score = round(correct / total * 20)
    return score, correct, total


def record_quiz_result(
    user, quiz: Quiz, score: int,
    answers: dict | None = None,
    qro_answers: dict | None = None,
) -> QuizResult:
    """Enregistre une tentative et applique RG-23 à RG-26.

    - tentatives illimitées, +1 à chaque soumission (RG-24) ;
    - on conserve le meilleur score (RG-25) ;
    - validation si score >= seuil ; jamais de rétrogradation (RG-26).
    - last_answers stocke les réponses de la dernière tentative (admin).
    """
    result, _ = QuizResult.objects.get_or_create(user=user, quiz=quiz)
    result.attempts += 1
    if score > result.score:
        result.score = score
    if not result.validated and result.score >= quiz.pass_threshold:
        result.validated = True
        result.validated_at = timezone.now()
    if answers is not None or qro_answers is not None:
        result.last_answers = {
            "qcm": {str(k): [int(c) for c in v] for k, v in (answers or {}).items()},
            "qro": {str(k): v for k, v in (qro_answers or {}).items()},
        }
    result.save()
    return result

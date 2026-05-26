"""Services du contenu : visibilité/publication, accès formation, déblocage
arborescent (modules → cours), streaming signé et notation QCM côté serveur.

Implémente RG-16 à RG-28 sur la hiérarchie Formation → Modules → Cours → Ressources/QCM.
L'accès à une formation réservée délègue à `apps.billing.services.has_subscription_access`
via `Formation.access_subscription_types` (le type `MEMBRE` ouvre l'accès aux
membres actifs).
"""
from django.conf import settings
from django.core.files.storage import default_storage
from django.db.models import Q
from django.utils import timezone

from .models import Course, Formation, FormationStatus, Module, Quiz, QuizResult


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
    """URL signée (MinIO/R2) valable 1h pour un média, en lecture `inline`.

    Jamais l'URL directe du bucket. La signature est faite contre
    `S3_PUBLIC_ENDPOINT_URL` (host joignable par le navigateur) ; le calcul est
    hors-ligne, donc indépendant de l'endpoint interne d'upload. En dev sans S3
    (USE_S3=False), retombe sur l'URL du stockage local.
    """
    if not key:
        return ""
    if not settings.USE_S3:
        return default_storage.url(key)

    import mimetypes

    import boto3
    from botocore.client import Config

    client = boto3.client(
        "s3",
        endpoint_url=settings.S3_PUBLIC_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_S3_REGION_NAME,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    params = {
        "Bucket": settings.AWS_STORAGE_BUCKET_NAME,
        "Key": key,
        "ResponseContentDisposition": "inline",
    }
    mime, _ = mimetypes.guess_type(key)
    if mime:
        params["ResponseContentType"] = mime
    return client.generate_presigned_url(
        "get_object", Params=params, ExpiresIn=settings.AWS_QUERYSTRING_EXPIRE,
    )


# ─── Accès à la formation (abonnement, RG-22 / RG-10) ───────────────────────

def formation_accessible(user, formation: Formation, accessible_types=None) -> bool:
    """Le membre détient-il un abonnement ouvrant cette formation ?

    Formation publique (`access_subscription_types` vide) → accessible à tout
    membre non bloqué. Sinon, accès si le membre détient un abonnement actif de
    l'UN des types requis. BLOQUÉ n'accède à rien (RG-10).
    """
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

def _course_quiz(course: Course):
    quiz = getattr(course, "quiz", None)
    return quiz if (quiz and quiz.active) else None


def course_completed(user, course: Course) -> bool:
    """Cours terminé : son QCM est validé, ou il n'a pas de QCM actif."""
    quiz = _course_quiz(course)
    if quiz is None:
        return True
    return QuizResult.objects.filter(user=user, quiz=quiz, validated=True).exists()


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
    """État d'un cours pour un membre : verrouillage (abonnement/quiz) + achèvement."""
    if not accessible:
        return {"locked": True, "lock_reason": "subscription", "completed": False}
    if not course_unlocked(user, course):
        return {"locked": True, "lock_reason": "quiz", "completed": False}
    return {"locked": False, "lock_reason": None, "completed": course_completed(user, course)}


def module_state(user, module: Module, accessible: bool) -> dict:
    """État d'un module : verrouillage (abonnement/quiz) + achèvement."""
    if not accessible:
        return {"locked": True, "lock_reason": "subscription", "completed": False}
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


def record_quiz_result(user, quiz: Quiz, score: int) -> QuizResult:
    """Enregistre une tentative et applique RG-23 à RG-26.

    - tentatives illimitées, +1 à chaque soumission (RG-24) ;
    - on conserve le meilleur score (RG-25) ;
    - validation si score >= seuil ; jamais de rétrogradation (RG-26).
    """
    result, _ = QuizResult.objects.get_or_create(user=user, quiz=quiz)
    result.attempts += 1
    if score > result.score:
        result.score = score
    if not result.validated and result.score >= quiz.pass_threshold:
        result.validated = True
        result.validated_at = timezone.now()
    result.save()
    return result

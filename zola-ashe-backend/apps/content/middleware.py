"""Middleware de contrôle d'accès séquentiel aux formations (KF6).

Intercepte les requêtes ``GET /api/courses/<id>/`` et vérifie que le membre
connecté a bien complété le cours précédent avant d'autoriser l'accès.
"""
import logging
import re

from django.http import JsonResponse

logger = logging.getLogger(__name__)

# Chemin correspondant aux détails de cours côté membre.
_COURSE_DETAIL_PATTERN = re.compile(r"^/api/courses/(\d+)/$")


class SequentialCourseAccessMiddleware:
    """Force l'ordre séquentiel : un cours n'est accessible que si le cours
    précédent (dans le même module) est complété (QCM validé)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        match = _COURSE_DETAIL_PATTERN.match(request.path_info)
        if match and request.method == "GET":
            course_id = int(match.group(1))

            # L'utilisateur doit être authentifié
            if not request.user.is_authenticated:
                return JsonResponse(
                    {"detail": "Authentification requise."},
                    status=401,
                )

            from .models import Course, QuizResult

            try:
                course = Course.objects.select_related("module__formation").get(id=course_id)
            except Course.DoesNotExist:
                return self.get_response(request)

            # Récupérer le cours précédent dans le même module (ordre inférieur)
            previous_course = (
                Course.objects.filter(
                    module_id=course.module_id,
                    order__lt=course.order,
                )
                .order_by("-order")
                .first()
            )

            # Si c'est le premier cours du module → pas de vérification
            if previous_course is None:
                return self.get_response(request)

            # Vérifier si le cours précédent a un QCM actif
            previous_quiz = getattr(previous_course, "quiz", None)
            if previous_quiz is None or not previous_quiz.active:
                # Pas de QCM → pas de prérequis
                return self.get_response(request)

            # Vérifier que l'utilisateur a validé le QCM du cours précédent
            validated = QuizResult.objects.filter(
                user=request.user,
                quiz=previous_quiz,
                validated=True,
            ).exists()

            if not validated:
                logger.info(
                    "Accès séquentiel bloqué : user=%s course=%s (prérequis : course=%s)",
                    request.user.id, course_id, previous_course.id,
                )
                return JsonResponse(
                    {
                        "detail": (
                            "Vous devez terminer le cours précédent "
                            "avant d'accéder à celui-ci."
                        ),
                        "prerequisite_course_id": previous_course.id,
                        "prerequisite_course_title": previous_course.title,
                    },
                    status=403,
                )

        return self.get_response(request)

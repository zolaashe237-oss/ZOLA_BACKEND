"""Middleware de blocage des fonctionnalités désactivées depuis le back-office.

Renvoie 403 sur les endpoints membre d'une fonctionnalité désactivée (quiz) ou
d'une section masquée de l'espace membre. Les routes admin (/api/admin/) ne
sont jamais concernées.
"""
from django.http import JsonResponse

from .features import MEMBER_SECTIONS, blocked_feature_for_path


class FeatureFlagsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info
        if path.startswith("/api/") and not path.startswith("/api/admin/"):
            feature = blocked_feature_for_path(path)
            if feature is not None:
                detail = ("Les quiz sont temporairement désactivés." if feature == "quiz" else
                          f"La section « {MEMBER_SECTIONS[feature][0]} » est temporairement désactivée.")
                return JsonResponse(
                    {"detail": detail,
                     "code": "feature_disabled", "feature": feature},
                    status=403,
                )
        return self.get_response(request)

from rest_framework.permissions import BasePermission
from rest_framework.throttling import ScopedRateThrottle

from apps.accounts.models import Role


class IsAdmin(BasePermission):
    """Réservé aux comptes administrateurs (role=ADMIN)."""
    message = "Accès réservé à l'administration."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == Role.ADMIN
        )


class AdminModerationThrottle(ScopedRateThrottle):
    """Limite les actions de modération irréversibles (bloc, suppression) — scope admin_moderation."""
    scope = "admin_moderation"

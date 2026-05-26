"""Routage racine de l'API ZOLA ASHÉ."""
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.permissions import AllowAny


def health(_request):
    """Endpoint de santé pour Traefik / UptimeRobot."""
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("health/", health),
    path("django-admin/", admin.site.urls),

    # Documentation API (OpenAPI 3) — accès libre
    path("api/schema/", SpectacularAPIView.as_view(permission_classes=[AllowAny]), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema",
         permission_classes=[AllowAny]), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema",
         permission_classes=[AllowAny]), name="redoc"),

    # Authentification & profil (CDC §3.3, §7.1) → /api/auth/... et /api/me/
    path("api/", include("apps.accounts.urls")),

    # Domaines fonctionnels
    path("api/community/", include("apps.community.urls")),
    path("api/", include("apps.content.urls")),  # → /api/content/ et /api/collections/
    path("api/billing/", include("apps.billing.urls")),
    path("api/blog/", include("apps.blog.urls")),       # journal public
    path("api/admin/", include("apps.admin_api.urls")),
]

"""Routes blog publiques (montées sous /api/blog/)."""
from rest_framework.routers import DefaultRouter

from .views import PublicArticleViewSet

router = DefaultRouter()
router.register("", PublicArticleViewSet, basename="article")

urlpatterns = router.urls

"""Routes du contenu (montées sous /api/) → /api/formations/, /api/resources/, /api/quizzes/."""
from rest_framework.routers import DefaultRouter

from .views import FormationViewSet, QuizViewSet, ResourceViewSet

router = DefaultRouter()
router.register("formations", FormationViewSet, basename="formation")
router.register("resources", ResourceViewSet, basename="resource")
router.register("quizzes", QuizViewSet, basename="quiz")

urlpatterns = router.urls

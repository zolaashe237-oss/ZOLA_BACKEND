"""Routes du contenu (montées sous /api/) → /api/courses/, /api/formations/, ..."""
from rest_framework.routers import DefaultRouter

from .views import CourseViewSet, FormationViewSet, QuizViewSet, ResourceViewSet

router = DefaultRouter()
router.register("courses", CourseViewSet, basename="course")
router.register("formations", FormationViewSet, basename="formation")
router.register("resources", ResourceViewSet, basename="resource")
router.register("quizzes", QuizViewSet, basename="quiz")

urlpatterns = router.urls

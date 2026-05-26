"""Routes communauté (montées sous /api/community/)."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("posts", views.PostViewSet, basename="post")

urlpatterns = [
    path("comments/<int:pk>/", views.CommentDeleteView.as_view(), name="comment-delete"),
    path("reports/", views.ReportCreateView.as_view(), name="report-create"),
    *router.urls,
]

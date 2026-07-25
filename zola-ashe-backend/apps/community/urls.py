"""Routes communauté (montées sous /api/community/)."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("posts", views.PostViewSet, basename="post")

urlpatterns = [
    path("comments/<int:pk>/", views.CommentDetailView.as_view(), name="comment-detail"),
    path("comments/<int:pk>/like/", views.CommentLikeView.as_view(), name="comment-like"),
    path("reports/", views.ReportCreateView.as_view(), name="report-create"),
    *router.urls,
]

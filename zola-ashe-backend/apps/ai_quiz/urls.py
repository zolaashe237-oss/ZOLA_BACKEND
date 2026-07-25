"""URLs de l'agent IA — mounted under /api/ dans config/urls.py.

Routes admin (IA-B6/B7/B10) : préfixe /api/admin/quiz/
Routes membre (IA-B9)      : préfixe /api/quiz/
"""
from django.urls import path

from .views import (
    GenerateQuizView,
    GenerationStatusView,
    QROReviewDecideView,
    QROReviewListView,
    SubmitQROView,
)

urlpatterns = [
    # Génération (IA-B6)
    path("admin/quiz/generate-ai/", GenerateQuizView.as_view(), name="ai-generate-quiz"),
    # Polling du statut (IA-B7)
    path(
        "admin/quiz/generate-ai/<uuid:job_id>/",
        GenerationStatusView.as_view(),
        name="ai-generate-quiz-status",
    ),
    # Soumission QRO côté membre (IA-B9)
    path(
        "quiz/<int:question_id>/submit-qro/",
        SubmitQROView.as_view(),
        name="ai-submit-qro",
    ),
    # File de revue admin des QRO ambiguës (IA-B10)
    path(
        "admin/quiz/qro-review/",
        QROReviewListView.as_view(),
        name="ai-qro-review-list",
    ),
    path(
        "admin/quiz/qro-review/<int:answer_id>/decide/",
        QROReviewDecideView.as_view(),
        name="ai-qro-review-decide",
    ),
]

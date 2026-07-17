from django.urls import path

from . import views

urlpatterns = [
    path("draft/", views.MemoirDraftView.as_view(), name="memoir-draft"),
    path("submit/", views.MemoirSubmitView.as_view(), name="memoir-submit"),
    path("transcribe/", views.TranscribeView.as_view(), name="memoir-transcribe"),
]

from django.urls import path

from . import views

urlpatterns = [
    path("draft/", views.MemoirDraftView.as_view(), name="memoir-draft"),
    path("submit/", views.MemoirSubmitView.as_view(), name="memoir-submit"),
    path("transcribe/", views.TranscribeView.as_view(), name="memoir-transcribe"),
    path("assemblyai-token/", views.AssemblyAITokenView.as_view(), name="memoir-assemblyai-token"),
    path("upload-image/", views.MemoirImageUploadView.as_view(), name="memoir-upload-image"),
]

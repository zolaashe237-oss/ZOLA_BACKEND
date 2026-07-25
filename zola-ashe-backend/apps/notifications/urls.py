from django.urls import path

from .views import MarkAllReadView, MarkNotifReadView, NotificationsListView

urlpatterns = [
    path("notifications/",             NotificationsListView.as_view()),
    path("notifications/read-all/",    MarkAllReadView.as_view()),
    path("notifications/<int:pk>/read/", MarkNotifReadView.as_view()),
]

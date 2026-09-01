"""Routes membre du système de parrainage."""
from django.urls import path
from . import views

urlpatterns = [
    path("me/",        views.MyAffiliateView.as_view(),  name="affiliate-me"),
    path("referrals/", views.MyReferralsView.as_view(),  name="affiliate-referrals"),
    path("leads/",     views.MyReferralsView.as_view(),  name="affiliate-leads"),
]

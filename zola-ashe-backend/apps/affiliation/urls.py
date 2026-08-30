"""Routes du module Affiliation (montées sous /api/affiliation/)."""
from django.urls import path

from . import views

urlpatterns = [
    path("",          views.AffiliationRootView.as_view(),  name="affiliation-root"),
    path("me/",       views.AffiliationMeView.as_view(),    name="affiliation-me"),
    path("leads/",    views.AffiliationLeadsView.as_view(), name="affiliation-leads"),
    path("referrals/", views.AffiliationLeadsView.as_view(), name="affiliation-referrals"),
    path("link/",     views.AffiliationLinkView.as_view(),  name="affiliation-link"),
]

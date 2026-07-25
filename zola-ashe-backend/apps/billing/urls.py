"""Routes billing (montées sous /api/billing/)."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("payments", views.MyPaymentsViewSet, basename="payment")

urlpatterns = [
    path("subscription-types/", views.SubscriptionTypesView.as_view(), name="subscription-types"),
    path("payments/initiate/", views.InitiatePaymentView.as_view(), name="payment-initiate"),
    path("payments/mock-confirm/", views.MockConfirmView.as_view(), name="payment-mock-confirm"),
    path("subscriptions/", views.MySubscriptionsView.as_view(), name="my-subscriptions"),
    path("subscriptions/close/", views.CloseSubscriptionView.as_view(), name="subscription-close"),
    path("webhooks/swinmo/", views.SwinmoWebhookView.as_view(), name="swinmo-webhook"),
    *router.urls,
]

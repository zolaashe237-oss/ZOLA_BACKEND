"""Sécurité du module de paiement (audit) : mode simulé, webhook, montants, relances."""
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import User, UserStatus

from .models import Payment, PaymentStatus, PaymentType

BASE_SETTINGS = dict(
    CELERY_TASK_ALWAYS_EAGER=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)


@override_settings(**BASE_SETTINGS, SWINMO_MOCK=False)
class MockModeLockedTests(APITestCase):
    def test_mock_confirm_refused_outside_mock_mode(self):
        user = User.objects.create_user("m@t.io", "pwd", full_name="M", status=UserStatus.RESTREINT)
        Payment.objects.create(user=user, type=PaymentType.INSCRIPTION, status=PaymentStatus.EN_ATTENTE,
                               amount=10000, swinmo_ref="ref-mock")
        self.client.force_authenticate(user)
        res = self.client.post("/api/billing/payments/mock-confirm/", {"reference": "ref-mock"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Payment.objects.get(swinmo_ref="ref-mock").status, PaymentStatus.EN_ATTENTE)

    def test_production_settings_force_mock_off(self):
        import importlib
        prod = importlib.import_module("config.settings.prod")   # quel que soit SWINMO_MOCK dans l'env
        self.assertFalse(prod.SWINMO_MOCK)

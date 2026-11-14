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


# ─── Webhook : seule la vérification chez Swinmo fait foi ────────────────────
import hashlib  # noqa: E402
import hmac  # noqa: E402
import json  # noqa: E402
from unittest.mock import patch  # noqa: E402

from apps.billing.models import Subscription  # noqa: E402
from apps.billing.services import apply_provider_verification  # noqa: E402
from apps.billing.verification import ProviderVerification  # noqa: E402

SECRET = "whsec_audit"


def _sign(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


def _order(reference, status="paid", amount=10000, currency="XAF", order_id="ord_1"):
    return {"success": True, "data": {"orderId": order_id, "status": status, "amount": amount,
                                      "currency": currency, "metadata": {"reference": reference}}}


@override_settings(**BASE_SETTINGS, SWINMO_MOCK=False, SWINMO_WEBHOOK_SECRET=SECRET)
class WebhookSecurityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("w@t.io", "pwd", full_name="W", status=UserStatus.RESTREINT)
        self.payment = Payment.objects.create(
            user=self.user, type=PaymentType.INSCRIPTION, status=PaymentStatus.EN_ATTENTE,
            amount=10000, swinmo_ref="ref_audit")
        patcher = patch("apps.billing.swinmo.get_order_details")
        self.get_order = patcher.start()
        self.addCleanup(patcher.stop)

    def _post(self, payload, signature=None, sign=True):
        body = json.dumps(payload).encode()
        headers = {}
        if sign:
            headers["HTTP_X_SWINMO_SIGNATURE"] = signature if signature is not None else _sign(body)
        return self.client.post("/api/billing/webhooks/swinmo/", data=body,
                                content_type="application/json", **headers)

    def _paid_event(self, **data):
        return {"event": "order.paid", "data": {"orderId": "ord_1", "reference": "ref_audit", **data}}

    def _refresh(self):
        self.payment.refresh_from_db()
        self.user.refresh_from_db()

    # 1. Signature absente ou invalide → rejet, aucun appel au provider
    def test_missing_or_invalid_signature_rejected(self):
        self.assertEqual(self._post(self._paid_event(), sign=False).status_code, 401)
        self.assertEqual(self._post(self._paid_event(), signature="00" * 32).status_code, 401)
        self.get_order.assert_not_called()
        self._refresh()
        self.assertEqual(self.payment.status, PaymentStatus.EN_ATTENTE)

    # 2. ID de transaction inconnu de notre base → rejet
    def test_unknown_transaction_rejected(self):
        self.get_order.return_value = _order("ref_inexistante")
        res = self._post({"event": "order.paid", "data": {"orderId": "ord_x", "reference": "ref_inexistante"}})
        self.assertEqual(res.status_code, 404)
        self.assertFalse(Subscription.objects.filter(user=self.user).exists())

    # 3. Webhook falsifié : corps « payé » mais GET Swinmo « failed » → rien crédité
    def test_forged_paid_body_but_provider_says_failed(self):
        self.get_order.return_value = _order("ref_audit", status="failed")
        res = self._post(self._paid_event(status="PAID", amount=10000))
        self.assertEqual(res.data["outcome"], "failed")
        self._refresh()
        self.assertEqual((self.payment.status, self.user.status), (PaymentStatus.ECHOUE, UserStatus.RESTREINT))

    def test_provider_pending_grants_nothing(self):
        self.get_order.return_value = _order("ref_audit", status="pending")
        self.assertEqual(self._post(self._paid_event()).data["outcome"], "pending")
        self._refresh()
        self.assertEqual(self.payment.status, PaymentStatus.EN_ATTENTE)

    def test_provider_order_with_other_reference_rejected(self):
        """Concordance : la commande Swinmo doit porter notre référence interne."""
        self.get_order.return_value = _order("ref_d_un_autre_paiement")
        self.assertEqual(self._post(self._paid_event()).data["outcome"], "unverifiable")
        self._refresh()
        self.assertEqual(self.payment.status, PaymentStatus.EN_ATTENTE)

    # 4. Montant inférieur (pas de coupons) → AMOUNT_MISMATCH, pas d'accès
    def test_lower_amount_marks_mismatch_without_access(self):
        self.get_order.return_value = _order("ref_audit", amount=500)
        with self.assertLogs("apps.billing.services", level="ERROR"):
            self.assertEqual(self._post(self._paid_event()).data["outcome"], "amount-mismatch")
        self._refresh()
        self.assertEqual((self.payment.status, self.payment.paid_amount), (PaymentStatus.AMOUNT_MISMATCH, 500))
        self.assertEqual(self.user.status, UserStatus.RESTREINT)

    def test_wrong_currency_marks_mismatch(self):
        self.get_order.return_value = _order("ref_audit", amount=10000, currency="USD")
        with self.assertLogs("apps.billing.services", level="ERROR"):
            self.assertEqual(self._post(self._paid_event()).data["outcome"], "amount-mismatch")
        self._refresh()
        self.assertEqual(self.user.status, UserStatus.RESTREINT)

    # 5. Coupons : la plateforme n'en propose pas — couvert par le test 4 (tout montant
    #    inférieur est refusé) ; le champ coupon_code est réservé.

    # 6. Montant supérieur (frais inclus) → accepté
    def test_higher_amount_accepted(self):
        self.get_order.return_value = _order("ref_audit", amount=10250)
        self.assertEqual(self._post(self._paid_event()).data["outcome"], "activated")
        self._refresh()
        self.assertEqual((self.payment.status, self.payment.paid_amount, self.user.status),
                         (PaymentStatus.VALIDE, 10250, UserStatus.ACTIF))

    # 7. Même webhook reçu deux fois → un seul crédit
    def test_same_webhook_twice_credits_once(self):
        self.get_order.return_value = _order("ref_audit")
        self.assertEqual(self._post(self._paid_event()).data["outcome"], "activated")
        self.assertEqual(self._post(self._paid_event()).data["outcome"], "duplicate")
        sub = Subscription.objects.get(user=self.user)
        self.assertEqual((sub.end - sub.start).days, 30)   # une seule période créditée

    def test_validated_payment_never_downgraded(self):
        self.get_order.return_value = _order("ref_audit")
        self._post(self._paid_event())
        self.get_order.return_value = _order("ref_audit", status="failed")
        failed = {"event": "order.failed", "data": {"orderId": "ord_1", "reference": "ref_audit"}}
        self.assertEqual(self._post(failed).data["outcome"], "duplicate")
        self._refresh()
        self.assertEqual(self.payment.status, PaymentStatus.VALIDE)

    def test_payment_kind_comes_from_database_not_from_webhook(self):
        """Un don (500 FCFA) dont le webhook prétend « INSCRIPTION » n'ouvre aucune adhésion."""
        don = Payment.objects.create(user=self.user, type=PaymentType.DON, status=PaymentStatus.EN_ATTENTE,
                                     amount=500, swinmo_ref="ref_don")
        self.get_order.return_value = _order("ref_don", amount=500, order_id="ord_don")
        self._post({"event": "order.paid", "data": {"orderId": "ord_don", "reference": "ref_don",
                                                    "metadata": {"reference": "ref_don", "kind": "INSCRIPTION"}}})
        don.refresh_from_db()
        self._refresh()
        self.assertEqual(don.status, PaymentStatus.VALIDE)
        self.assertEqual(self.user.status, UserStatus.RESTREINT)
        self.assertFalse(Subscription.objects.filter(user=self.user).exists())

    def test_apply_is_idempotent_on_direct_calls(self):
        """Deux traitements successifs (ex. webhook + réconciliation) → un seul crédit."""
        ok = ProviderVerification("paid", "ord_1", 10000, "XAF")
        self.assertEqual(apply_provider_verification(self.payment, ok), "activated")
        self.assertEqual(apply_provider_verification(self.payment, ok), "duplicate")
        self.assertEqual(Subscription.objects.filter(user=self.user).count(), 1)

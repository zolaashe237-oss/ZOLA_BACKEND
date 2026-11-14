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


# ─── 8. Retour navigateur ───────────────────────────────────────────────────

@override_settings(**BASE_SETTINGS, SWINMO_MOCK=False)
class BrowserReturnTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("r@t.io", "pwd", full_name="R", status=UserStatus.RESTREINT)
        self.payment = Payment.objects.create(
            user=self.user, type=PaymentType.INSCRIPTION, status=PaymentStatus.EN_ATTENTE,
            amount=10000, swinmo_ref="ref_retour")
        self.client.force_authenticate(self.user)
        from django.core.cache import cache
        cache.clear()
        patcher = patch("apps.billing.swinmo.list_orders_by_email")
        self.list_orders = patcher.start()
        self.addCleanup(patcher.stop)

    def _return_page(self):
        from django.core.cache import cache
        cache.clear()   # ignore l'espacement des vérifications entre deux appels du test
        return self.client.get("/api/billing/payments/status/", {"ref": "ref_retour"}).json()

    def test_browser_return_alone_never_activates(self):
        # Swinmo ne connaît pas (encore) la commande, ou la dit en attente → rien n'est accordé.
        self.list_orders.return_value = {"success": True, "data": []}
        self.assertEqual(self._return_page()["status"], PaymentStatus.EN_ATTENTE)
        self.list_orders.return_value = {"success": True, "data": [
            {"orderId": "ord_r", "status": "pending", "amount": 10000, "currency": "XAF",
             "metadata": {"reference": "ref_retour"}}]}
        self.assertEqual(self._return_page()["status"], PaymentStatus.EN_ATTENTE)
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.RESTREINT)

    def test_return_activates_only_when_provider_confirms(self):
        """Webhook perdu : le retour retrouve la commande chez Swinmo et ne crédite que
        sur sa confirmation (statut payé, bon montant, notre référence)."""
        self.list_orders.return_value = {"success": True, "data": [
            {"orderId": "ord_r", "status": "paid", "amount": 10000, "currency": "XAF",
             "metadata": {"reference": "ref_retour"}}]}
        self.assertEqual(self._return_page()["status"], PaymentStatus.VALIDE)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.provider_tx_id, "ord_r")
        self.list_orders.assert_called_with("r@t.io")

    def test_return_verification_is_throttled(self):
        self.list_orders.return_value = {"success": True, "data": []}
        self.client.get("/api/billing/payments/status/", {"ref": "ref_retour"})
        self.client.get("/api/billing/payments/status/", {"ref": "ref_retour"})
        self.assertEqual(self.list_orders.call_count, 1)


# ─── Réconciliation (webhook perdu) ─────────────────────────────────────────

@override_settings(**BASE_SETTINGS, SWINMO_MOCK=False, PAYMENT_FOLLOWUP_MAX_DAYS=14)
class ReconciliationTests(APITestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.user = User.objects.create_user("rc@t.io", "pwd", full_name="RC", status=UserStatus.RESTREINT)
        patcher = patch("apps.billing.swinmo.list_orders_by_email")
        self.list_orders = patcher.start()
        self.addCleanup(patcher.stop)

    def _pending(self, ref, age, amount=10000):
        from django.utils import timezone
        payment = Payment.objects.create(user=self.user, type=PaymentType.INSCRIPTION,
                                         status=PaymentStatus.EN_ATTENTE, amount=amount, swinmo_ref=ref)
        Payment.objects.filter(pk=payment.pk).update(paid_at=timezone.now() - age)
        return payment

    def _orders(self, *orders):
        self.list_orders.return_value = {"success": True, "data": [
            {"orderId": f"ord_{ref}", "status": status, "amount": 10000, "currency": "XAF",
             "metadata": {"reference": ref}} for ref, status in orders]}

    def test_lost_webhook_recovered_by_reconciliation(self):
        from datetime import timedelta
        from apps.billing.services import run_payment_reconciliation
        paid = self._pending("ref_paid", timedelta(minutes=20))
        failed = self._pending("ref_failed", timedelta(minutes=20))
        self._orders(("ref_paid", "paid"), ("ref_failed", "failed"))
        summary = run_payment_reconciliation()
        paid.refresh_from_db(); failed.refresh_from_db()
        self.assertEqual((paid.status, failed.status), (PaymentStatus.VALIDE, PaymentStatus.ECHOUE))
        self.assertEqual((summary["activated"], summary["failed"]), (1, 1))

    def test_recent_and_expired_payments_not_checked(self):
        from datetime import timedelta
        from apps.billing.services import run_payment_reconciliation
        self._pending("ref_recent", timedelta(minutes=1))     # le webhook peut encore arriver
        self._pending("ref_old", timedelta(days=20))          # au-delà du suivi (14 j)
        self._orders(("ref_recent", "paid"), ("ref_old", "paid"))
        self.assertEqual(run_payment_reconciliation(), {})
        self.list_orders.assert_not_called()

    def test_older_pending_payments_are_checked_less_often(self):
        from datetime import timedelta
        from apps.billing.services import run_payment_reconciliation
        self._pending("ref_day_old", timedelta(hours=5))
        self._orders()
        self.assertEqual(run_payment_reconciliation(), {"pending": 1})
        self.assertEqual(run_payment_reconciliation(), {"not-due": 1})   # revérifié dans 1 h
        self.assertEqual(self.list_orders.call_count, 1)

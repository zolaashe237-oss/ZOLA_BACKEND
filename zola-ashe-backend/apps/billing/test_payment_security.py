"""Sécurité du module de paiement (audit) : mode simulé, webhook, montants, relances."""
from datetime import timedelta

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


# ─── 10. Relances des paiements abandonnés ou échoués ───────────────────────

@override_settings(**BASE_SETTINGS, SWINMO_MOCK=False, PAYMENT_FOLLOWUP_MAX_DAYS=14)
class UnpaidReminderTests(APITestCase):
    def setUp(self):
        from django.utils import timezone
        self.t0 = timezone.now()
        self.user = User.objects.create_user("rel@t.io", "pwd", full_name="Rel Ance",
                                             status=UserStatus.RESTREINT)
        patcher = patch("apps.billing.tasks.send_unpaid_payment_reminder.delay")
        self.send_email = patcher.start()
        self.addCleanup(patcher.stop)

    def _payment(self, ptype=PaymentType.INSCRIPTION, status=PaymentStatus.EN_ATTENTE, ref="rel_1", age=None):
        payment = Payment.objects.create(user=self.user, type=ptype, status=status,
                                         amount=10000, swinmo_ref=ref)
        Payment.objects.filter(pk=payment.pk).update(paid_at=self.t0 - (age or timedelta(0)))
        payment.refresh_from_db()
        return payment

    def _run(self, after):
        from apps.billing.services import run_unpaid_reminders
        return run_unpaid_reminders(now=self.t0 + after)

    def test_schedule_5min_1h_1d_3d_7d_then_stop(self):
        payment = self._payment()
        self.assertEqual(self._run(timedelta(minutes=4))["sent"], 0)     # trop tôt
        self.assertEqual(self._run(timedelta(minutes=6))["sent"], 1)     # 1re relance
        self.assertEqual(self._run(timedelta(minutes=7))["sent"], 0)     # pas de doublon
        self.assertEqual(self._run(timedelta(hours=1, minutes=1))["sent"], 1)
        self.assertEqual(self._run(timedelta(days=1, minutes=1))["sent"], 1)
        self.assertEqual(self._run(timedelta(days=3, minutes=1))["sent"], 1)
        self.assertEqual(self._run(timedelta(days=7, minutes=1))["sent"], 1)
        self.assertEqual(self._run(timedelta(days=10))["sent"], 0)       # 5 relances au plus
        payment.refresh_from_db()
        self.assertEqual(payment.reminder_count, 5)
        self.assertIsNotNone(payment.last_reminder_at)
        self.assertEqual(self.send_email.call_count, 5)

    def test_stops_once_paid(self):
        payment = self._payment()
        self.assertEqual(self._run(timedelta(minutes=6))["sent"], 1)
        Payment.objects.filter(pk=payment.pk).update(status=PaymentStatus.VALIDE)
        self.assertEqual(self._run(timedelta(hours=2))["sent"], 0)

    def test_stops_when_access_obtained_otherwise(self):
        self._payment()
        self.user.set_status(UserStatus.ACTIF)   # ex. validation manuelle par l'admin
        self.assertEqual(self._run(timedelta(minutes=6)), {"sent": 0, "stopped": 1})

    def test_stops_after_max_delay(self):
        self._payment(age=timedelta(days=15))
        self.assertEqual(self._run(timedelta(0))["sent"], 0)

    def test_failed_payment_reminded_but_never_donations(self):
        self._payment(status=PaymentStatus.ECHOUE, ref="rel_failed")
        self._payment(ptype=PaymentType.DON, ref="rel_don")
        self.assertEqual(self._run(timedelta(minutes=6))["sent"], 1)

    def test_only_latest_attempt_reminded(self):
        self._payment(ref="rel_old", age=timedelta(minutes=10))
        self._payment(ref="rel_new")                      # nouvelle tentative du membre
        self.assertEqual(self._run(timedelta(minutes=6)), {"sent": 1, "stopped": 1})

    def test_reminder_creates_notification_and_email_content(self):
        from django.core import mail
        from apps.billing.tasks import send_unpaid_payment_reminder
        from apps.notifications.models import Notification
        payment = self._payment()
        self._run(timedelta(minutes=6))
        self.assertTrue(Notification.objects.filter(user=self.user, title="Paiement à finaliser").exists())
        self.send_email.assert_called_once_with(payment.pk)
        send_unpaid_payment_reminder.run(payment.pk)   # rendu réel de l'email
        self.assertIn("/inscription?step=3", mail.outbox[-1].body)


# ─── 9. Routes payantes : paiement confirmé obligatoire ─────────────────────

@override_settings(**BASE_SETTINGS, SWINMO_MOCK=False)
class PaidRoutesTests(APITestCase):
    """Un paiement en attente ou au montant non conforme n'ouvre rien : seul un paiement
    VALIDE (confirmé par Swinmo) donne accès, et l'accès est vérifié côté serveur."""

    def setUp(self):
        from apps.content.models import Course, Formation, FormationStatus, LibraryPdf, Module
        self.user = User.objects.create_user("pr@t.io", "pwd", full_name="PR", status=UserStatus.RESTREINT)
        self.formation = Formation.objects.create(title="Payante", slug="payante", price=15000,
                                                  access_subscription_types=["MEMBRE"],
                                                  status=FormationStatus.PUBLISHED)
        self.course = Course.objects.create(module=Module.objects.create(formation=self.formation, title="M"),
                                            title="C", order=1)
        self.book = LibraryPdf.objects.create(title="Livre", bucket_key="k", access_level="MEMBRE",
                                              price=3000, is_active=True)
        for status, ref in ((PaymentStatus.EN_ATTENTE, "pr_pending"), (PaymentStatus.AMOUNT_MISMATCH, "pr_ko")):
            Payment.objects.create(user=self.user, type=PaymentType.FORMATION, status=status, amount=15000,
                                   swinmo_ref=f"{ref}_f", formation=self.formation)
            Payment.objects.create(user=self.user, type=PaymentType.LIVRE, status=status, amount=3000,
                                   swinmo_ref=f"{ref}_l", library_pdf=self.book)
            Payment.objects.create(user=self.user, type=PaymentType.INSCRIPTION, status=status, amount=10000,
                                   swinmo_ref=f"{ref}_i")
        self.client.force_authenticate(self.user)

    def test_unconfirmed_payments_open_nothing(self):
        self.assertTrue(self.client.get(f"/api/formations/{self.formation.id}/").json()["locked"])
        self.assertEqual(self.client.post(f"/api/courses/{self.course.id}/complete/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/library/{self.book.id}/stream/").status_code, 403)
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.RESTREINT)

    def test_access_flags_cannot_be_set_by_the_client(self):
        """Le profil ne permet pas de s'attribuer un statut ou une branche."""
        self.client.patch("/api/me/", {"status": "ACTIF", "access_levels": ["MEMBRE", "FEMME"]}, format="json")
        self.user.refresh_from_db()
        self.assertEqual((self.user.status, self.user.access_levels), (UserStatus.RESTREINT, []))
        self.assertTrue(self.client.get(f"/api/formations/{self.formation.id}/").json()["locked"])

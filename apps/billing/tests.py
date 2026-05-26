"""Tests du chantier Billing (modèle du livret) : webhook Swinmo (RG-08),
activation inscription/cotisation/don, cron de statut (RG-02/03)."""
import hashlib
import hmac
import json
from datetime import timedelta
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User, UserStatus
from .models import Payment, PaymentStatus, PaymentType, Subscription, SubscriptionType
from .services import activate_paid_payment, initiate_payment, is_member, run_daily_status_check

SECRET = "whsec_test"
TEST_SETTINGS = dict(
    CELERY_TASK_ALWAYS_EAGER=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    SWINMO_WEBHOOK_SECRET=SECRET,
    SWINMO_MOCK=False,   # teste le vrai chemin Swinmo (create_checkout_link mocké)
    PRICE_INSCRIPTION=10000,
    PRICE_COTISATION=2000,
)


def sign(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


def make_pending(user, ptype=PaymentType.INSCRIPTION, amount=10000, ref="ref1"):
    return Payment.objects.create(user=user, type=ptype, status=PaymentStatus.EN_ATTENTE,
                                  amount=amount, swinmo_ref=ref)


def make_member(user, days_left=30):
    """Adhésion active avec échéance d'accès (par défaut +30j, à jour).

    `days_left` négatif simule une échéance déjà dépassée.
    """
    today = timezone.now().date()
    return Subscription.objects.create(user=user, type=SubscriptionType.MEMBRE,
                                       start=today, end=today + timedelta(days=days_left),
                                       active=True)


@override_settings(**TEST_SETTINGS)
class WebhookTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("u@z.com", "Passw0rd!", full_name="U",
                                              email_verified=True, status=UserStatus.RESTREINT)

    def _post(self, payload: dict, signature=None):
        body = json.dumps(payload).encode()
        sig = signature if signature is not None else sign(body)
        return self.client.post("/api/billing/webhooks/swinmo/", data=body,
                                content_type="application/json", HTTP_X_SWINMO_SIGNATURE=sig)

    def test_invalid_signature_rejected(self):
        make_pending(self.user)
        r = self._post({"event": "order.paid", "data": {"metadata": {"reference": "ref1"}}},
                       signature="deadbeef")
        self.assertEqual(r.status_code, 401)
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.RESTREINT)  # rien activé

    def test_order_paid_inscription_creates_membership_and_sets_actif(self):
        make_pending(self.user)
        r = self._post({"event": "order.paid",
                        "data": {"metadata": {"reference": "ref1", "kind": "INSCRIPTION"}}})
        self.assertEqual(r.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.ACTIF)
        sub = Subscription.objects.get(user=self.user, type=SubscriptionType.MEMBRE)
        self.assertTrue(sub.active)
        # 1ʳᵉ période d'accès incluse → échéance à +30 jours.
        self.assertEqual(sub.end, timezone.now().date() + timedelta(days=30))
        self.assertEqual(Payment.objects.get(swinmo_ref="ref1").status, PaymentStatus.VALIDE)

    def test_idempotent_duplicate_paid_ignored(self):
        make_pending(self.user)
        payload = {"event": "order.paid",
                   "data": {"metadata": {"reference": "ref1", "kind": "INSCRIPTION"}}}
        self.assertEqual(self._post(payload).data["outcome"], "activated")
        r = self._post(payload)  # rejoué
        self.assertEqual(r.data["outcome"], "duplicate")
        self.assertEqual(Subscription.objects.filter(user=self.user).count(), 1)

    def test_order_failed_marks_echoue(self):
        make_pending(self.user)
        r = self._post({"event": "order.failed", "data": {"metadata": {"reference": "ref1"}}})
        self.assertEqual(r.data["outcome"], "failed")
        self.assertEqual(Payment.objects.get(swinmo_ref="ref1").status, PaymentStatus.ECHOUE)


@override_settings(**TEST_SETTINGS)
class ActivationTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("a@z.com", "Passw0rd!", full_name="A",
                                              email_verified=True, status=UserStatus.RESTREINT)

    def test_inscription_opens_membership_with_first_period_and_actif(self):
        p = make_pending(self.user, ref="i1")
        activate_paid_payment(p, "INSCRIPTION")
        sub = Subscription.objects.get(user=self.user, type=SubscriptionType.MEMBRE)
        self.assertEqual(sub.end, timezone.now().date() + timedelta(days=30))  # 1ʳᵉ période incluse
        self.assertTrue(sub.active)
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.ACTIF)
        self.assertTrue(is_member(self.user))

    def test_cotisation_extends_due_date_cumulatively(self):
        make_member(self.user, days_left=10)  # encore 10 jours
        p = make_pending(self.user, ptype=PaymentType.COTISATION, amount=2000, ref="cum")
        activate_paid_payment(p, "COTISATION")
        sub = Subscription.objects.get(user=self.user, type=SubscriptionType.MEMBRE)
        # cumul : 10 jours restants + 30 jours de période = échéance à +40 jours.
        self.assertEqual(sub.end, timezone.now().date() + timedelta(days=40))

    def test_cotisation_restores_actif_for_member(self):
        make_member(self.user)  # adhérent mais RESTREINT (cotisation en retard)
        p = make_pending(self.user, ptype=PaymentType.COTISATION, amount=2000, ref="c1")
        activate_paid_payment(p, "COTISATION")
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.ACTIF)

    def test_cotisation_without_membership_keeps_restreint(self):
        p = make_pending(self.user, ptype=PaymentType.COTISATION, amount=2000, ref="c2")
        activate_paid_payment(p, "COTISATION")
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.RESTREINT)  # pas adhérent → inchangé

    def test_don_has_no_access_effect(self):
        p = make_pending(self.user, ptype=PaymentType.DON, amount=5000, ref="d1")
        activate_paid_payment(p, "DON")
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.RESTREINT)
        self.assertFalse(Subscription.objects.filter(user=self.user).exists())


@override_settings(**TEST_SETTINGS)
class InitiateTests(APITestCase):
    def test_initiate_creates_pending_and_calls_swinmo(self):
        user = User.objects.create_user("i@z.com", "Passw0rd!", full_name="I",
                                        email_verified=True, status=UserStatus.RESTREINT)
        with patch("apps.billing.services.swinmo.create_checkout_link",
                   return_value={"url": "https://swinmo/pay/abc"}) as mock:
            result = initiate_payment(user, "INSCRIPTION")
        mock.assert_called_once()
        self.assertEqual(result["checkout_url"], "https://swinmo/pay/abc")
        self.assertEqual(result["amount"], 10000)
        payment = Payment.objects.get(id=result["payment_id"])
        self.assertEqual(payment.status, PaymentStatus.EN_ATTENTE)
        self.assertEqual(payment.swinmo_ref, result["reference"])

    def test_initiate_don_uses_free_amount(self):
        user = User.objects.create_user("d@z.com", "Passw0rd!", full_name="D",
                                        email_verified=True, status=UserStatus.ACTIF)
        with patch("apps.billing.services.swinmo.create_checkout_link",
                   return_value={"url": "https://swinmo/pay/don"}):
            result = initiate_payment(user, "DON", amount=7500)
        self.assertEqual(result["amount"], 7500)
        self.assertEqual(Payment.objects.get(id=result["payment_id"]).type, PaymentType.DON)


@override_settings(**TEST_SETTINGS)
class CloseSubscriptionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("close@z.com", "Passw0rd!", full_name="C",
                                              email_verified=True, status=UserStatus.ACTIF)
        self.client.force_authenticate(self.user)

    def test_close_deactivates_and_restricts_and_audits(self):
        from apps.audit.models import AuditAction, AuditLog
        make_member(self.user, days_left=20)  # encore 20 jours payés
        r = self.client.post("/api/billing/subscriptions/close/", {"reason": "départ"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["closed"])
        sub = Subscription.objects.get(user=self.user, type=SubscriptionType.MEMBRE)
        self.assertFalse(sub.active)                          # adhésion désactivée
        self.assertEqual(sub.end, timezone.now().date())      # échéance figée à aujourd'hui
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.RESTREINT)
        self.assertFalse(is_member(self.user))
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.CLOSE_SUBSCRIPTION,
                        target_type="Subscription", target_id=str(sub.id)).exists())

    def test_close_without_membership_returns_400(self):
        r = self.client.post("/api/billing/subscriptions/close/", {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_reinscription_after_close_reopens_membership(self):
        make_member(self.user, days_left=5)
        self.client.post("/api/billing/subscriptions/close/", {}, format="json")
        p = make_pending(self.user, ref="re1")
        activate_paid_payment(p, "INSCRIPTION")
        self.user.refresh_from_db()
        self.assertEqual(self.user.status, UserStatus.ACTIF)
        self.assertTrue(is_member(self.user))                 # nouvelle adhésion active
        self.assertEqual(Subscription.objects.filter(
            user=self.user, type=SubscriptionType.MEMBRE, active=True).count(), 1)

    def test_close_requires_auth(self):
        self.client.force_authenticate(None)
        r = self.client.post("/api/billing/subscriptions/close/", {}, format="json")
        self.assertEqual(r.status_code, 401)


@override_settings(**TEST_SETTINGS)
class DailyStatusCheckTests(APITestCase):
    def _aged_actif(self, email):
        """Membre ACTIF dont le statut a été changé il y a 2 jours (hors fenêtre 24h)."""
        u = User.objects.create_user(email, "Passw0rd!", full_name="X",
                                     email_verified=True, status=UserStatus.ACTIF, role=Role.MEMBER)
        User.objects.filter(id=u.id).update(status_changed_at=timezone.now() - timedelta(days=2))
        u.refresh_from_db()
        return u

    def test_expired_beyond_grace_restricts(self):
        u = self._aged_actif("c@z.com")
        make_member(u, days_left=-10)  # échéance dépassée de 10j (> grâce 7j)
        summary = run_daily_status_check()
        self.assertEqual(summary["restricted"], 1)
        u.refresh_from_db()
        self.assertEqual(u.status, UserStatus.RESTREINT)

    def test_expired_within_grace_stays_actif(self):
        u = self._aged_actif("g@z.com")
        make_member(u, days_left=-3)  # échue depuis 3j, encore dans la grâce (7j)
        run_daily_status_check()
        u.refresh_from_db()
        self.assertEqual(u.status, UserStatus.ACTIF)

    def test_member_up_to_date_stays_actif(self):
        u = self._aged_actif("ok@z.com")
        make_member(u, days_left=15)  # échéance dans 15 jours
        run_daily_status_check()
        u.refresh_from_db()
        self.assertEqual(u.status, UserStatus.ACTIF)

    def test_reminder_sent_before_due_date(self):
        u = self._aged_actif("r@z.com")
        make_member(u, days_left=3)  # J-3 → rappel
        summary = run_daily_status_check()
        self.assertEqual(summary["reminders"], 1)
        u.refresh_from_db()
        self.assertEqual(u.status, UserStatus.ACTIF)

    def test_non_member_not_touched(self):
        u = self._aged_actif("nm@z.com")  # ACTIF mais sans adhésion
        run_daily_status_check()
        u.refresh_from_db()
        self.assertEqual(u.status, UserStatus.ACTIF)  # pas adhérent → ignoré

    def test_admin_forced_actif_within_24h_skipped(self):
        u = User.objects.create_user("f@z.com", "Passw0rd!", full_name="F",
                                     email_verified=True, status=UserStatus.ACTIF, role=Role.MEMBER)
        make_member(u, days_left=-60)  # échéance très dépassée…
        run_daily_status_check()       # …mais statut forcé ACTIF il y a < 24h
        u.refresh_from_db()
        self.assertEqual(u.status, UserStatus.ACTIF)  # non modifié (exception RG-02)

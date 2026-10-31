"""Achat d'une formation à l'unité par un membre sans abonnement."""
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User, UserStatus
from apps.content.models import Formation, FormationStatus

from .models import FormationPurchase, Payment, PaymentStatus, PaymentType

TEST_SETTINGS = dict(
    CELERY_TASK_ALWAYS_EAGER=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    SWINMO_MOCK=True,
)


@override_settings(**TEST_SETTINGS)
class FormationPurchaseTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "libre@test.io", "pwd", full_name="Libre", status=UserStatus.RESTREINT)
        self.formation = Formation.objects.create(
            title="Reiki", slug="reiki", access_subscription_types=["MEMBRE"], price=15000,
            status=FormationStatus.PUBLISHED)
        self.not_for_sale = Formation.objects.create(
            title="Réservée", slug="reservee", access_subscription_types=["MEMBRE"],
            status=FormationStatus.PUBLISHED)
        self.client.force_authenticate(self.user)

    def _detail(self, formation):
        return self.client.get(f"/api/formations/{formation.id}/")

    def test_priced_formation_visible_and_locked_before_purchase(self):
        ids = [f["id"] for f in self.client.get("/api/formations/").json()]
        self.assertIn(self.formation.id, ids)
        self.assertNotIn(self.not_for_sale.id, ids)
        data = self._detail(self.formation).json()
        self.assertEqual((data["locked"], data["lock_reason"], data["price"], data["purchased"]),
                         (True, "subscription", 15000, False))

    def test_purchase_flow_grants_access(self):
        res = self.client.post("/api/billing/payments/initiate/",
                               {"kind": "FORMATION", "formation_id": self.formation.id}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["amount"], 15000)
        payment = Payment.objects.get(swinmo_ref=res.json()["reference"])
        self.assertEqual((payment.type, payment.formation_id), (PaymentType.FORMATION, self.formation.id))

        self.client.post("/api/billing/payments/mock-confirm/",
                         {"reference": payment.swinmo_ref}, format="json")
        payment.refresh_from_db()
        self.assertEqual(payment.status, PaymentStatus.VALIDE)
        self.assertTrue(FormationPurchase.objects.filter(user=self.user, formation=self.formation).exists())

        # Même instance user que pendant l'achat : son cache d'achats doit avoir été invalidé.
        data = self._detail(self.formation).json()
        self.assertEqual((data["locked"], data["purchased"]), (False, True))
        # L'achat n'ouvre que cette formation, pas l'abonnement.
        self.assertEqual(self.user.status, UserStatus.RESTREINT)

    def test_cannot_buy_formation_without_price_or_twice(self):
        res = self.client.post("/api/billing/payments/initiate/",
                               {"kind": "FORMATION", "formation_id": self.not_for_sale.id}, format="json")
        self.assertEqual(res.status_code, 400)
        FormationPurchase.objects.create(user=self.user, formation=self.formation)
        res = self.client.post("/api/billing/payments/initiate/",
                               {"kind": "FORMATION", "formation_id": self.formation.id}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_admin_price_cleared_on_non_paid_formation(self):
        admin = User.objects.create_user("a@test.io", "pwd", full_name="A", role=Role.ADMIN,
                                         status=UserStatus.ACTIF)
        self.client.force_authenticate(admin)
        res = self.client.patch(f"/api/admin/formations/{self.formation.id}/",
                                {"access_subscription_types": [], "price": 5000}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.json()["price"])
        res = self.client.patch(f"/api/admin/formations/{self.not_for_sale.id}/",
                                {"price": 8000}, format="json")
        self.assertEqual(res.json()["price"], 8000)

    def test_payment_status_by_ref_then_by_id(self):
        res = self.client.post("/api/billing/payments/initiate/",
                               {"kind": "FORMATION", "formation_id": self.formation.id}, format="json")
        ref, pid = res.json()["reference"], res.json()["payment_id"]
        data = self.client.get("/api/billing/payments/status/", {"ref": ref}).json()
        self.assertEqual((data["status"], data["kind"], data["formation_id"]),
                         (PaymentStatus.EN_ATTENTE, "FORMATION", self.formation.id))
        # Le webhook a remplacé la référence par l'id de commande Swinmo : repli sur payment_id.
        Payment.objects.filter(pk=pid).update(swinmo_ref="swinmo-order-1")
        res = self.client.get("/api/billing/payments/status/", {"ref": ref, "payment_id": pid})
        self.assertEqual(res.json()["payment_id"], pid)
        # Le paiement d'un autre membre reste invisible.
        other = User.objects.create_user("autre@test.io", "pwd", full_name="Autre")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get("/api/billing/payments/status/", {"payment_id": pid}).status_code, 404)

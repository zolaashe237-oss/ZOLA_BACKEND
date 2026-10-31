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

    def test_price_on_existing_members_formation_makes_it_paid(self):
        """Formation existante en accès « Membres » : lui donner un prix la rend payante."""
        admin = User.objects.create_user("a@test.io", "pwd", full_name="A", role=Role.ADMIN,
                                         status=UserStatus.ACTIF)
        members_only = Formation.objects.create(title="Existante", slug="existante",
                                                status=FormationStatus.PUBLISHED)  # importée, accès []
        self.client.force_authenticate(admin)
        res = self.client.patch(f"/api/admin/formations/{members_only.id}/", {"price": 8000}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.json()["price"], res.json()["access_subscription_types"]), (8000, ["MEMBRE"]))
        # Le non-abonné la voit, verrouillée, et peut l'acheter.
        self.client.force_authenticate(User.objects.get(pk=self.user.pk))
        data = self._detail(members_only).json()
        self.assertEqual((data["locked"], data["price"]), (True, 8000))

    def test_admin_price_cleared_on_public_formation(self):
        admin = User.objects.create_user("a@test.io", "pwd", full_name="A", role=Role.ADMIN,
                                         status=UserStatus.ACTIF)
        self.client.force_authenticate(admin)
        res = self.client.patch(f"/api/admin/formations/{self.formation.id}/",
                                {"is_public": True, "access_subscription_types": [], "price": 5000},
                                format="json")
        self.assertIsNone(res.json()["price"])

    def test_priced_branch_formation_not_free_for_subscriber_without_branch(self):
        femme = Formation.objects.create(title="Femme", slug="femme", branch="FEMME", price=9000,
                                         access_subscription_types=["MEMBRE"],
                                         status=FormationStatus.PUBLISHED)
        abonne = User.objects.create_user("ab@test.io", "pwd", full_name="Ab",
                                          status=UserStatus.ACTIF, access_levels=["MEMBRE"])
        self.client.force_authenticate(abonne)
        data = self._detail(femme).json()
        self.assertEqual((data["locked"], data["lock_reason"]), (True, "subscription"))
        abonne.access_levels = ["MEMBRE", "FEMME"]
        abonne.save(update_fields=["access_levels"])
        self.client.force_authenticate(User.objects.get(pk=abonne.pk))
        self.assertFalse(self._detail(femme).json()["locked"])

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

    def _admin_client(self):
        admin = User.objects.create_user("adm@test.io", "pwd", full_name="Adm", role=Role.ADMIN,
                                         status=UserStatus.ACTIF)
        self.client.force_authenticate(admin)

    def test_admin_validates_whatsapp_formation_purchase(self):
        self._admin_client()
        res = self.client.post("/api/admin/payments/manual/", {
            "user_id": self.user.id, "kind": "FORMATION", "formation_id": self.formation.id,
            "reason": "Paiement WhatsApp"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        payment = Payment.objects.get(pk=res.json()["payment_id"])
        self.assertEqual((payment.type, payment.status, payment.amount, payment.formation_id),
                         (PaymentType.FORMATION, PaymentStatus.VALIDE, 15000, self.formation.id))
        self.assertTrue(FormationPurchase.objects.filter(user=self.user, formation=self.formation).exists())

        # Le membre voit la formation déverrouillée.
        self.client.force_authenticate(User.objects.get(pk=self.user.pk))
        self.assertFalse(self._detail(self.formation).json()["locked"])

        # Une seconde validation est refusée (pas de double encaissement).
        self._admin_client_again()
        res = self.client.post("/api/admin/payments/manual/", {
            "user_id": self.user.id, "kind": "FORMATION", "formation_id": self.formation.id,
            "reason": "Doublon"}, format="json")
        self.assertEqual(res.status_code, 400)

    def _admin_client_again(self):
        self.client.force_authenticate(User.objects.get(email="adm@test.io"))

    def test_admin_manual_formation_without_price_requires_amount(self):
        self._admin_client()
        payload = {"user_id": self.user.id, "kind": "FORMATION",
                   "formation_id": self.not_for_sale.id, "reason": "WhatsApp"}
        self.assertEqual(self.client.post("/api/admin/payments/manual/", payload, format="json").status_code, 400)
        res = self.client.post("/api/admin/payments/manual/", {**payload, "amount": 9000}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_admin_manual_branch_access(self):
        self._admin_client()
        res = self.client.post("/api/admin/payments/manual/", {
            "user_id": self.user.id, "kind": "BRANCHE_FEMME", "reason": "WhatsApp"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.user.refresh_from_db()
        self.assertIn("FEMME", self.user.access_levels)

    def _bought_manually(self):
        self._admin_client()
        res = self.client.post("/api/admin/payments/manual/", {
            "user_id": self.user.id, "kind": "FORMATION", "formation_id": self.formation.id,
            "reason": "WhatsApp"}, format="json")
        return res.json()["payment_id"]

    def test_full_refund_revokes_formation_access(self):
        pid = self._bought_manually()
        res = self.client.post("/api/admin/payments/refund/", {
            "user_id": self.user.id, "amount": 15000, "payment_id": pid,
            "reason": "Remboursement"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()["access_revoked"])
        self.assertFalse(FormationPurchase.objects.filter(user=self.user, formation=self.formation).exists())
        refund = Payment.objects.get(pk=res.json()["payment_id"])
        self.assertEqual((refund.amount, refund.formation_id), (-15000, self.formation.id))
        # Côté membre : formation de nouveau verrouillée, et rachetable.
        self.client.force_authenticate(User.objects.get(pk=self.user.pk))
        self.assertTrue(self._detail(self.formation).json()["locked"])

    def test_partial_refund_keeps_access_unless_requested(self):
        pid = self._bought_manually()
        res = self.client.post("/api/admin/payments/refund/", {
            "user_id": self.user.id, "amount": 5000, "payment_id": pid,
            "reason": "Geste commercial"}, format="json")
        self.assertFalse(res.json()["access_revoked"])
        self.assertTrue(FormationPurchase.objects.filter(user=self.user, formation=self.formation).exists())
        res = self.client.post("/api/admin/payments/refund/", {
            "user_id": self.user.id, "amount": 5000, "payment_id": pid, "revoke_access": True,
            "reason": "Retrait"}, format="json")
        self.assertTrue(res.json()["access_revoked"])

    def test_refund_rejects_other_members_payment(self):
        pid = self._bought_manually()
        other = User.objects.create_user("o@test.io", "pwd", full_name="O")
        res = self.client.post("/api/admin/payments/refund/", {
            "user_id": other.id, "amount": 15000, "payment_id": pid, "reason": "x"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_member_detail_lists_formation_purchases(self):
        pid = self._bought_manually()
        data = self.client.get(f"/api/admin/members/{self.user.id}/").json()
        self.assertEqual(data["formation_purchases"], [{
            "formation_id": self.formation.id, "formation_title": "Reiki",
            "purchased_at": data["formation_purchases"][0]["purchased_at"],
            "payment_id": pid, "amount": 15000, "manual": True,
        }])

    def test_admin_sets_price_at_creation(self):
        self._admin_client()
        res = self.client.post("/api/admin/formations/", {
            "title": "Nouvelle", "category": "FORMATION", "access_subscription_types": ["MEMBRE"],
            "is_public": False, "price": 12000, "status": "DRAFT"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["price"], 12000)

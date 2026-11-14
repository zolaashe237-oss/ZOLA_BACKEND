"""Achat d'un livre (PDF de la bibliothèque) à l'unité par un compte gratuit."""
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User, UserStatus
from apps.content.models import LibraryPdf

from .models import LibraryPdfPurchase, Payment, PaymentStatus, PaymentType

TEST_SETTINGS = dict(
    CELERY_TASK_ALWAYS_EAGER=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    SWINMO_MOCK=True,
)


@override_settings(**TEST_SETTINGS)
class LibraryPurchaseTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "gratuit@test.io", "pwd", full_name="Gratuit", status=UserStatus.RESTREINT)
        self.book = LibraryPdf.objects.create(title="Livret", bucket_key="k", access_level="MEMBRE",
                                              price=3000, is_active=True)
        self.not_for_sale = LibraryPdf.objects.create(title="Réservé", bucket_key="k2",
                                                      access_level="MEMBRE", is_active=True)
        self.free = LibraryPdf.objects.create(title="Offert", bucket_key="k3", access_level="MEMBRE",
                                              is_gratuit=True, is_active=True)
        self.client.force_authenticate(self.user)

    def _library(self):
        return {b["title"]: b for b in self.client.get("/api/library/").json()}

    def test_free_account_sees_paid_books_locked_with_price(self):
        books = self._library()
        self.assertEqual((books["Livret"]["locked"], books["Livret"]["price"]), (True, 3000))
        self.assertEqual((books["Réservé"]["locked"], books["Réservé"]["price"]), (True, None))
        self.assertEqual(self.client.get(f"/api/library/{self.book.id}/stream/").status_code, 403)

    def test_book_marked_free_is_readable(self):
        # « Rendre ce document accessible gratuitement » (admin) est enfin respecté.
        self.assertFalse(self._library()["Offert"]["locked"])
        self.assertEqual(self.client.get(f"/api/library/{self.free.id}/stream/").status_code, 200)

    def test_purchase_flow_unlocks_only_this_book(self):
        res = self.client.post("/api/billing/payments/initiate/",
                               {"kind": "LIVRE", "library_pdf_id": self.book.id}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["amount"], 3000)
        payment = Payment.objects.get(swinmo_ref=res.json()["reference"])
        self.assertEqual((payment.type, payment.library_pdf_id), (PaymentType.LIVRE, self.book.id))

        self.client.post("/api/billing/payments/mock-confirm/", {"reference": payment.swinmo_ref}, format="json")
        self.assertTrue(LibraryPdfPurchase.objects.filter(user=self.user, library_pdf=self.book).exists())
        books = self._library()
        self.assertEqual((books["Livret"]["locked"], books["Livret"]["purchased"]), (False, True))
        self.assertTrue(books["Réservé"]["locked"])
        self.assertEqual(self.client.get(f"/api/library/{self.book.id}/stream/").status_code, 200)

        status_ = self.client.get("/api/billing/payments/status/", {"ref": payment.swinmo_ref}).json()
        self.assertEqual((status_["kind"], status_["library_pdf_id"]), ("LIVRE", self.book.id))

    def test_cannot_buy_unpriced_or_already_accessible_book(self):
        for pdf in (self.not_for_sale, self.free):
            res = self.client.post("/api/billing/payments/initiate/",
                                   {"kind": "LIVRE", "library_pdf_id": pdf.id}, format="json")
            self.assertEqual(res.status_code, 400)

    def test_admin_manual_purchase_and_refund_revokes(self):
        admin = User.objects.create_user("adm@test.io", "pwd", full_name="Adm", role=Role.ADMIN,
                                         status=UserStatus.ACTIF)
        self.client.force_authenticate(admin)
        res = self.client.post("/api/admin/payments/manual/", {
            "user_id": self.user.id, "kind": "LIVRE", "library_pdf_id": self.book.id,
            "reason": "WhatsApp"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        pid = res.json()["payment_id"]
        self.assertEqual(Payment.objects.get(pk=pid).status, PaymentStatus.VALIDE)
        detail = self.client.get(f"/api/admin/members/{self.user.id}/").json()
        self.assertEqual([b["title"] for b in detail["library_purchases"]], ["Livret"])

        res = self.client.post("/api/admin/payments/refund/", {
            "user_id": self.user.id, "amount": 3000, "payment_id": pid, "reason": "Remboursement"},
            format="json")
        self.assertTrue(res.json()["access_revoked"])
        self.assertFalse(LibraryPdfPurchase.objects.filter(user=self.user, library_pdf=self.book).exists())

    def test_blocked_account_sees_no_book(self):
        self.user.set_status(UserStatus.BLOQUE)
        self.client.force_authenticate(User.objects.get(pk=self.user.pk))
        self.assertEqual(self.client.get("/api/library/").json(), [])

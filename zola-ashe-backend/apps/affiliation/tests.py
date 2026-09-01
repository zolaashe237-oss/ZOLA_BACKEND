"""Tests du squelette Affiliation : les endpoints ne doivent plus renvoyer 404."""
from rest_framework.test import APITestCase

from apps.accounts.models import User, UserStatus


class AffiliationSkeletonTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("aff@z.com", "Passw0rd!", full_name="Aff",
                                              email_verified=True, status=UserStatus.ACTIF)

    def test_root_is_public_and_returns_200(self):
        r = self.client.get("/api/affiliation/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["implemented"])

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get("/api/affiliation/me/").status_code, 401)

    def test_me_returns_stub_when_authenticated(self):
        self.client.force_authenticate(self.user)
        r = self.client.get("/api/affiliation/me/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["leads_count"], 0)

    def test_leads_returns_empty_list(self):
        self.client.force_authenticate(self.user)
        r = self.client.get("/api/affiliation/leads/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 0)

    def test_link_returns_202_stub(self):
        self.client.force_authenticate(self.user)
        r = self.client.post("/api/affiliation/link/", {"code": "XYZ"}, format="json")
        self.assertEqual(r.status_code, 202)

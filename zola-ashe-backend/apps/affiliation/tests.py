"""Tests des routes /api/affiliation/ (servies par apps.affiliate, l'ancien
squelette n'est plus monté)."""
from rest_framework.test import APITestCase

from apps.accounts.models import User, UserStatus


class AffiliationRoutesTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("aff@z.com", "Passw0rd!", full_name="Aff",
                                              email_verified=True, status=UserStatus.ACTIF)

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get("/api/affiliation/me/").status_code, 401)

    def test_me_returns_stats_when_authenticated(self):
        self.client.force_authenticate(self.user)
        r = self.client.get("/api/affiliation/me/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["total_referrals"], 0)
        self.assertTrue(r.data["referral_code"])

    def test_leads_returns_empty_list(self):
        self.client.force_authenticate(self.user)
        r = self.client.get("/api/affiliation/leads/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 0)

    def test_affiliate_alias_serves_same_routes(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/affiliate/me/").status_code, 200)
        self.assertEqual(self.client.get("/api/affiliate/referrals/").status_code, 200)

"""Tests du chantier Communauté : audience (RG-30), like (RG-29),
partage (RG-34), signalement (RG-31)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User, UserStatus
from .models import Audience, Comment, Like, Post, Report

TEST_SETTINGS = dict(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)


def make_post(author, audience=Audience.TOUS, **kw):
    return Post.objects.create(author=author, text="hello", audience=audience, **kw)


@override_settings(**TEST_SETTINGS)
class FeedVisibilityTests(APITestCase):
    def setUp(self):
        self.actif = User.objects.create_user("a@z.com", "Passw0rd!", full_name="A",
                                               email_verified=True, status=UserStatus.ACTIF)
        self.author = User.objects.create_user("auth@z.com", "Passw0rd!", full_name="Au",
                                                email_verified=True, status=UserStatus.ACTIF)
        self.restreint = User.objects.create_user("r@z.com", "Passw0rd!", full_name="R",
                                                   email_verified=True, status=UserStatus.RESTREINT)
        self.p1 = make_post(self.author, Audience.TOUS)
        self.p2 = make_post(self.author, Audience.TOUS)

    def test_active_member_sees_the_feed(self):
        self.client.force_authenticate(self.actif)
        ids = [p["id"] for p in self.client.get("/api/community/posts/").data["results"]]
        self.assertIn(self.p1.id, ids)
        self.assertIn(self.p2.id, ids)

    def test_restricted_member_sees_nothing(self):
        # L'accès à la communauté exige une adhésion à jour (membre ACTIF).
        self.client.force_authenticate(self.restreint)
        self.assertEqual(self.client.get("/api/community/posts/").data["count"], 0)

    def test_scheduled_future_post_hidden(self):
        make_post(self.author, Audience.TOUS, scheduled_at=timezone.now() + timedelta(days=1))
        self.client.force_authenticate(self.actif)
        r = self.client.get("/api/community/posts/")
        self.assertEqual(r.data["count"], 2)  # p1 et p2 immédiats ; le programmé est masqué


@override_settings(**TEST_SETTINGS)
class PostActionsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("u@z.com", "Passw0rd!", full_name="U",
                                              email_verified=True, status=UserStatus.ACTIF)
        self.author = User.objects.create_user("au@z.com", "Passw0rd!", full_name="Au",
                                                email_verified=True, status=UserStatus.ACTIF)
        self.post = make_post(self.author, Audience.TOUS)
        self.client.force_authenticate(self.user)

    def test_create_post_to_tous(self):
        r = self.client.post("/api/community/posts/", {"text": "coucou", "audience": "TOUS"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["author"]["id"], self.user.id)

    def test_restricted_member_cannot_post(self):
        restreint = User.objects.create_user("rr@z.com", "Passw0rd!", full_name="RR",
                                              email_verified=True, status=UserStatus.RESTREINT)
        self.client.force_authenticate(restreint)
        r = self.client.post("/api/community/posts/", {"text": "x", "audience": "TOUS"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_empty_post_rejected(self):
        r = self.client.post("/api/community/posts/", {"audience": "TOUS"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_like_toggle_updates_count(self):
        r = self.client.post(f"/api/community/posts/{self.post.id}/like/")
        self.assertTrue(r.data["liked"])
        self.assertEqual(r.data["likes_count"], 1)
        r = self.client.post(f"/api/community/posts/{self.post.id}/like/")
        self.assertFalse(r.data["liked"])
        self.assertEqual(r.data["likes_count"], 0)
        self.assertEqual(Like.objects.filter(post=self.post).count(), 0)

    def test_share_creates_new_post_referencing_origin(self):
        r = self.client.post(f"/api/community/posts/{self.post.id}/share/")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["shared_from"], self.post.id)
        self.assertEqual(r.data["author"]["id"], self.user.id)

    def test_comment_create_and_list(self):
        r = self.client.post(f"/api/community/posts/{self.post.id}/comments/",
                             {"text": "joli"}, format="json")
        self.assertEqual(r.status_code, 201)
        r = self.client.get(f"/api/community/posts/{self.post.id}/comments/")
        self.assertEqual(len(r.data), 1)

    def test_can_only_delete_own_post(self):
        r = self.client.delete(f"/api/community/posts/{self.post.id}/")
        self.assertEqual(r.status_code, 403)  # post d'un autre auteur
        mine = make_post(self.user, Audience.TOUS)
        r = self.client.delete(f"/api/community/posts/{mine.id}/")
        self.assertEqual(r.status_code, 204)
        mine.refresh_from_db()
        self.assertFalse(mine.active)  # suppression logique


@override_settings(**TEST_SETTINGS)
class ReportTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("u@z.com", "Passw0rd!", full_name="U",
                                              email_verified=True, status=UserStatus.ACTIF)
        self.author = User.objects.create_user("au@z.com", "Passw0rd!", full_name="Au",
                                                email_verified=True, status=UserStatus.ACTIF)
        self.post = make_post(self.author, Audience.TOUS)
        self.client.force_authenticate(self.user)

    def test_report_post_then_duplicate_rejected(self):
        payload = {"target_type": "POST", "target_id": self.post.id, "reason": "spam"}
        r = self.client.post("/api/community/reports/", payload, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Report.objects.count(), 1)
        r = self.client.post("/api/community/reports/", payload, format="json")
        self.assertEqual(r.status_code, 403)  # déjà signalé (RG-31)

    def test_report_unknown_target_rejected(self):
        r = self.client.post("/api/community/reports/",
                             {"target_type": "POST", "target_id": 9999, "reason": "x"}, format="json")
        self.assertEqual(r.status_code, 403)

"""Tests des interrupteurs de fonctionnalités (quiz, cotisation mensuelle, sections masquées)."""
from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.billing.models import Subscription, SubscriptionType
from apps.billing.services import run_daily_status_check

from .models import GlobalSettings, Role, User, UserStatus

TEST_SETTINGS = dict(
    CELERY_TASK_ALWAYS_EAGER=True,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)


@override_settings(**TEST_SETTINGS)
class FeatureFlagsTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            "admin@test.io", "pwd", full_name="Admin", role=Role.ADMIN, status=UserStatus.ACTIF)
        self.member = User.objects.create_user(
            "membre@test.io", "pwd", full_name="Membre", status=UserStatus.ACTIF)

    def _patch(self, data, user=None):
        self.client.force_authenticate(user or self.admin)
        return self.client.patch("/api/admin/settings/features/", data, format="json")

    def test_member_cannot_change_features(self):
        self.assertEqual(self._patch({"quiz_enabled": False}, user=self.member).status_code, 403)

    def test_public_settings_expose_flags(self):
        self._patch({"quiz_enabled": False, "hidden_sections": ["communaute"]})
        data = self.client.get("/api/settings/").json()
        self.assertFalse(data["quiz_enabled"])
        self.assertEqual(data["hidden_sections"], ["communaute"])

    def test_unknown_section_rejected(self):
        self.assertEqual(self._patch({"hidden_sections": ["inconnue"]}).status_code, 400)

    def test_hidden_section_blocks_member_api(self):
        self._patch({"hidden_sections": ["communaute"]})
        self.client.force_authenticate(self.member)
        res = self.client.get("/api/community/posts/")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["feature"], "communaute")

    def test_quiz_disabled_blocks_quiz_api(self):
        self._patch({"quiz_enabled": False})
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get("/api/quizzes/").status_code, 403)

    def test_monthly_disabled_hides_plan_and_refuses_payment(self):
        self._patch({"monthly_subscription_enabled": False})
        kinds = [p["kind"] for p in self.client.get("/api/billing/subscription-types/").json()]
        self.assertNotIn("COTISATION", kinds)
        self.client.force_authenticate(self.member)
        res = self.client.post("/api/billing/payments/initiate/", {"kind": "COTISATION"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_monthly_toggle_reactivates_then_extends(self):
        today = timezone.now().date()
        late = User.objects.create_user("late@test.io", "pwd", full_name="Late",
                                        status=UserStatus.RESTREINT)
        sub = Subscription.objects.create(user=late, type=SubscriptionType.MEMBRE,
                                          start=today - timedelta(days=90),
                                          end=today - timedelta(days=30))
        # Non-adhérent restreint : ne doit pas être réactivé.
        free = User.objects.create_user("free@test.io", "pwd", full_name="Free",
                                        status=UserStatus.RESTREINT)

        res = self._patch({"monthly_subscription_enabled": False})
        self.assertEqual(res.json()["members_reactivated"], 1)
        late.refresh_from_db(); free.refresh_from_db()
        self.assertEqual(late.status, UserStatus.ACTIF)
        self.assertEqual(free.status, UserStatus.RESTREINT)

        # Le cron ne restreint plus personne tant que la cotisation est désactivée.
        late.status_changed_at = timezone.now() - timedelta(days=2)
        late.save(update_fields=["status_changed_at"])
        self.assertEqual(run_daily_status_check()["restricted"], 0)

        res = self._patch({"monthly_subscription_enabled": True})
        self.assertEqual(res.json()["subscriptions_extended"], 1)
        sub.refresh_from_db()
        self.assertEqual(sub.end, today + timedelta(days=7))

    def test_settings_cache_invalidated_on_save(self):
        self.assertTrue(GlobalSettings.cached().quiz_enabled)
        self._patch({"quiz_enabled": False})
        self.assertFalse(GlobalSettings.cached().quiz_enabled)

    def test_ai_credits_flags_quota_error_until_next_success(self):
        from apps.ai_quiz.models import AIQuizJob, JobStatus, SourceType
        from apps.ai_quiz.tests import make_module

        module = make_module()

        def job(status, error=""):
            return AIQuizJob.objects.create(module=module, source_type=SourceType.MANUAL_TEXT,
                                            source_text="x" * 100, status=status, error_message=error)

        self.client.force_authenticate(self.admin)
        url = "/api/admin/settings/features/"
        self.assertIsNone(self.client.get(url).json()["ai_credits"]["quota_error_at"])

        job(JobStatus.FAILED, "429 RESOURCE_EXHAUSTED: You exceeded your current quota")
        credits = self.client.get(url).json()["ai_credits"]
        self.assertIsNotNone(credits["quota_error_at"])
        self.assertIn("quota", credits["quota_error"])

        job(JobStatus.DONE)
        self.assertIsNone(self.client.get(url).json()["ai_credits"]["quota_error_at"])

    def test_cache_invalidated_again_after_commit(self):
        """Une lecture concurrente avant le COMMIT ne doit pas laisser l'ancienne valeur en cache."""
        from .models import _global_settings_cache_key
        settings_obj = GlobalSettings.load()
        stale = {f.attname: getattr(settings_obj, f.attname) for f in GlobalSettings._meta.concrete_fields}
        with self.captureOnCommitCallbacks(execute=True):
            settings_obj.quiz_enabled = False
            settings_obj.save()
            cache.set(_global_settings_cache_key(), stale, 60)   # relecture concurrente de l'ancienne ligne
        self.assertFalse(GlobalSettings.cached().quiz_enabled)

    def test_cached_instance_is_persisted_row(self):
        GlobalSettings.cached()
        obj = GlobalSettings.cached()   # 2e appel : reconstruit depuis le cache
        self.assertFalse(obj._state.adding)
        self.assertEqual(obj.pk, 1)

    def test_cache_outage_falls_back_to_database(self):
        from unittest.mock import patch
        self._patch({"hidden_sections": ["communaute"]})
        self.client.force_authenticate(self.member)
        with patch("django.core.cache.cache.get", side_effect=ConnectionError("redis down")), \
             patch("django.core.cache.cache.set", side_effect=ConnectionError("redis down")):
            self.assertEqual(GlobalSettings.cached().hidden_sections, ["communaute"])
            self.assertEqual(self.client.get("/api/community/posts/").status_code, 403)

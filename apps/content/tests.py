"""Tests du chantier Contenu (Formation → Modules(arbre) → Cours → Ressources/QCM) :
accès formation (RG-22/10), déblocage séquentiel et hiérarchique (RG-16), notation
QCM serveur (RG-23 à RG-26), streaming signé / YouTube (RG-17/19), publication
programmée (§5.4)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User, UserStatus

from .models import (
    Category,
    Choice,
    Course,
    Formation,
    FormationStatus,
    Module,
    Question,
    Quiz,
    Resource,
    ResourceType,
    VideoSource,
)
from .services import publish_due_formations

TEST_SETTINGS = dict(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)


def make_formation(**kw) -> Formation:
    defaults = dict(title="Formation", category=Category.FORMATION,
                    status=FormationStatus.PUBLISHED, access_subscription_types=["MEMBRE"])
    defaults.update(kw)
    return Formation.objects.create(**defaults)


def add_quiz(*, course=None, formation=None, threshold=15) -> Quiz:
    """QCM à 2 questions (bonne réponse = choix 1)."""
    quiz = Quiz.objects.create(course=course, formation=formation, pass_threshold=threshold)
    for qi in range(1, 3):
        q = Question.objects.create(quiz=quiz, text=f"Q{qi}", order=qi)
        Choice.objects.create(question=q, text="bonne", is_correct=True, order=1)
        Choice.objects.create(question=q, text="mauvaise", is_correct=False, order=2)
    return quiz


def good_answers(quiz: Quiz) -> dict:
    return {str(q.id): [c.id for c in q.choices.filter(is_correct=True)] for q in quiz.questions.all()}


def bad_answers(quiz: Quiz) -> dict:
    return {str(q.id): [c.id for c in q.choices.filter(is_correct=False)] for q in quiz.questions.all()}


@override_settings(**TEST_SETTINGS)
class FormationAccessTests(APITestCase):
    def setUp(self):
        self.actif = User.objects.create_user("actif@z.com", "Passw0rd!", full_name="A",
                                               email_verified=True, status=UserStatus.ACTIF)
        self.restreint = User.objects.create_user("restr@z.com", "Passw0rd!", full_name="R",
                                                   email_verified=True, status=UserStatus.RESTREINT)
        self.bloque = User.objects.create_user("bloq@z.com", "Passw0rd!", full_name="B",
                                                email_verified=True, status=UserStatus.BLOQUE)
        self.reserve = make_formation(title="Réservé", access_subscription_types=["MEMBRE"])
        self.public = make_formation(title="Public", access_subscription_types=[])

    def _locked(self, user, formation):
        self.client.force_authenticate(user)
        return self.client.get(f"/api/formations/{formation.id}/").data["locked"]

    def test_reserved_active_member_only(self):
        self.assertFalse(self._locked(self.actif, self.reserve))
        self.assertTrue(self._locked(self.restreint, self.reserve))

    def test_public_open_to_any_non_blocked(self):
        self.assertFalse(self._locked(self.actif, self.public))
        self.assertFalse(self._locked(self.restreint, self.public))

    def test_blocked_no_access(self):
        self.assertTrue(self._locked(self.bloque, self.reserve))
        self.assertTrue(self._locked(self.bloque, self.public))  # RG-10


@override_settings(**TEST_SETTINGS)
class SequentialUnlockTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("u@z.com", "Passw0rd!", full_name="U",
                                              email_verified=True, status=UserStatus.ACTIF)
        self.formation = make_formation()
        self.module = Module.objects.create(formation=self.formation, title="M1", order=1)
        self.c1 = Course.objects.create(module=self.module, title="C1", order=1)
        self.c2 = Course.objects.create(module=self.module, title="C2", order=2)
        self.quiz1 = add_quiz(course=self.c1)
        self.client.force_authenticate(self.user)

    def _course(self, course_id):
        data = self.client.get(f"/api/formations/{self.formation.id}/").data
        courses = {c["id"]: c for m in data["modules"] for c in m["courses"]}
        return courses[course_id]

    def test_second_course_locked_until_first_validated(self):
        self.assertTrue(self._course(self.c2.id)["access"]["locked"])
        self.assertEqual(self._course(self.c2.id)["access"]["lock_reason"], "quiz")

    def test_quiz_validation_unlocks_next_course(self):
        r = self.client.post(f"/api/quizzes/{self.quiz1.id}/submit/",
                             {"answers": good_answers(self.quiz1)}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["validated"])
        self.assertFalse(self._course(self.c2.id)["access"]["locked"])

    def test_child_module_requires_parent_completed(self):
        child = Module.objects.create(formation=self.formation, parent=self.module, title="M1.1", order=1)
        Course.objects.create(module=child, title="C-child", order=1)
        # c2 (sans quiz) reste, le module parent n'est pas terminé tant que quiz1 non validé
        data = self.client.get(f"/api/formations/{self.formation.id}/").data
        parent = next(m for m in data["modules"] if m["id"] == self.module.id)
        self.assertTrue(parent["children"][0]["access"]["locked"])
        # valide le quiz du cours 1 ; c2 n'a pas de quiz → module parent terminé
        self.client.post(f"/api/quizzes/{self.quiz1.id}/submit/",
                        {"answers": good_answers(self.quiz1)}, format="json")
        data = self.client.get(f"/api/formations/{self.formation.id}/").data
        parent = next(m for m in data["modules"] if m["id"] == self.module.id)
        self.assertFalse(parent["children"][0]["access"]["locked"])


@override_settings(**TEST_SETTINGS)
class QuizGradingTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("u@z.com", "Passw0rd!", full_name="U",
                                              email_verified=True, status=UserStatus.ACTIF)
        self.formation = make_formation()
        self.module = Module.objects.create(formation=self.formation, title="M1", order=1)
        self.c1 = Course.objects.create(module=self.module, title="C1", order=1)
        self.quiz = add_quiz(course=self.c1)
        self.client.force_authenticate(self.user)

    def _submit(self, answers):
        return self.client.post(f"/api/quizzes/{self.quiz.id}/submit/", {"answers": answers}, format="json")

    def test_full_score_validates(self):
        r = self._submit(good_answers(self.quiz))
        self.assertEqual(r.data["score"], 20)
        self.assertEqual(r.data["correct"], 2)
        self.assertTrue(r.data["validated"])

    def test_wrong_answers_not_validated(self):
        r = self._submit(bad_answers(self.quiz))
        self.assertEqual(r.data["score"], 0)
        self.assertFalse(r.data["validated"])

    def test_keeps_best_score_no_downgrade(self):
        self._submit(good_answers(self.quiz))
        r = self._submit(bad_answers(self.quiz))
        self.assertEqual(r.data["score"], 20)      # RG-25
        self.assertTrue(r.data["validated"])         # RG-26
        self.assertEqual(r.data["attempts"], 2)      # RG-24

    def test_choices_never_expose_correct_answer(self):
        r = self.client.get(f"/api/quizzes/{self.quiz.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("is_correct", r.data["questions"][0]["choices"][0])

    def test_locked_quiz_forbidden(self):
        c2 = Course.objects.create(module=self.module, title="C2", order=2)
        q2 = add_quiz(course=c2)
        r = self.client.get(f"/api/quizzes/{q2.id}/")  # c2 verrouillé (c1 non validé)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["lock_reason"], "quiz")


@override_settings(**TEST_SETTINGS)
class ResourceStreamTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("s@z.com", "Passw0rd!", full_name="S",
                                              email_verified=True, status=UserStatus.ACTIF)
        self.restreint = User.objects.create_user("r@z.com", "Passw0rd!", full_name="R",
                                                   email_verified=True, status=UserStatus.RESTREINT)
        self.formation = make_formation(access_subscription_types=["MEMBRE"])
        self.module = Module.objects.create(formation=self.formation, title="M1", order=1)
        self.course = Course.objects.create(module=self.module, title="C1", order=1)
        self.youtube = Resource.objects.create(
            course=self.course, resource_type=ResourceType.VIDEO,
            video_source=VideoSource.YOUTUBE, youtube_url="https://youtu.be/abc", title="YT")
        self.pdf = Resource.objects.create(
            course=self.course, resource_type=ResourceType.PDF, bucket_key="pdfs/livre.pdf", title="PDF")

    def test_youtube_stream_returns_link(self):
        self.client.force_authenticate(self.user)
        r = self.client.get(f"/api/resources/{self.youtube.id}/stream/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["kind"], "youtube")
        self.assertEqual(r.data["url"], "https://youtu.be/abc")

    def test_file_stream_returns_signed_url(self):
        self.client.force_authenticate(self.user)
        r = self.client.get(f"/api/resources/{self.pdf.id}/stream/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["kind"], "file")
        self.assertIn("url", r.data)

    def test_stream_forbidden_for_non_member(self):
        self.client.force_authenticate(self.restreint)
        r = self.client.get(f"/api/resources/{self.pdf.id}/stream/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["lock_reason"], "subscription")


@override_settings(**TEST_SETTINGS)
class ScheduledPublicationTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("u@z.com", "Passw0rd!", full_name="U",
                                              email_verified=True, status=UserStatus.ACTIF)
        self.client.force_authenticate(self.user)

    def test_future_scheduled_not_visible(self):
        f = make_formation(status=FormationStatus.SCHEDULED, publish_at=timezone.now() + timedelta(days=3))
        self.assertEqual(self.client.get(f"/api/formations/{f.id}/").status_code, 404)

    def test_past_scheduled_visible(self):
        f = make_formation(status=FormationStatus.SCHEDULED, publish_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.client.get(f"/api/formations/{f.id}/").status_code, 200)

    def test_draft_not_visible(self):
        f = make_formation(status=FormationStatus.DRAFT)
        self.assertEqual(self.client.get(f"/api/formations/{f.id}/").status_code, 404)

    def test_publish_due_flips_status(self):
        due = make_formation(status=FormationStatus.SCHEDULED, publish_at=timezone.now() - timedelta(minutes=1))
        future = make_formation(status=FormationStatus.SCHEDULED, publish_at=timezone.now() + timedelta(days=1))
        self.assertEqual(publish_due_formations(), 1)
        due.refresh_from_db(); future.refresh_from_db()
        self.assertEqual(due.status, FormationStatus.PUBLISHED)
        self.assertIsNone(due.publish_at)
        self.assertEqual(future.status, FormationStatus.SCHEDULED)

"""Tests du chantier Admin : permission, journalisation, et règles
RG-06/13/15/20/21/27/33/39/40."""
from datetime import date

from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User, UserStatus
from apps.audit.models import AuditAction, AuditLog
from apps.billing.models import Payment, PaymentStatus, PaymentType, Subscription, SubscriptionType
from apps.community.models import Audience, Comment, Like, Post
from apps.content.models import (
    Category,
    Choice,
    Course,
    Formation,
    FormationStatus,
    Module,
    Question,
    Quiz,
    QuizResult,
    Resource,
)

TEST_SETTINGS = dict(
    CELERY_TASK_ALWAYS_EAGER=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)


@override_settings(**TEST_SETTINGS)
class AdminBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin@z.com", "Passw0rd!", full_name="Adm",
                                               email_verified=True, status=UserStatus.ACTIF, role=Role.ADMIN)
        self.member = User.objects.create_user("m@z.com", "Passw0rd!", full_name="Mbr",
                                                email_verified=True, status=UserStatus.RESTREINT, role=Role.MEMBER)
        self.client.force_authenticate(self.admin)


class PermissionTests(AdminBase):
    def test_member_forbidden_on_admin_routes(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get("/api/admin/dashboard/").status_code, 403)
        self.assertEqual(self.client.get("/api/admin/members/").status_code, 403)

    def test_admin_allowed(self):
        self.assertEqual(self.client.get("/api/admin/dashboard/").status_code, 200)


class MemberManagementTests(AdminBase):
    def test_block_sets_status_and_audits(self):
        r = self.client.post(f"/api/admin/members/{self.member.id}/block/", {"reason": "abus"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.member.refresh_from_db()
        self.assertEqual(self.member.status, UserStatus.BLOQUE)
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.BLOCK_USER,
                                                target_id=str(self.member.id)).exists())

    def test_warn_increments_and_flags_recidive(self):
        for _ in range(3):
            r = self.client.post(f"/api/admin/members/{self.member.id}/warn/",
                                 {"reason": "x"}, format="json")
        self.assertTrue(r.data["recidive_alert"])
        self.assertEqual(AuditLog.objects.filter(action=AuditAction.WARN_USER).count(), 3)

class FinanceTests(AdminBase):
    def test_manual_inscription_activates_membership_and_audits(self):
        r = self.client.post("/api/admin/payments/manual/",
                             {"user_id": self.member.id, "kind": "INSCRIPTION", "reason": "espèces"},
                             format="json")
        self.assertEqual(r.status_code, 201)
        self.member.refresh_from_db()
        self.assertEqual(self.member.status, UserStatus.ACTIF)        # RG-06
        self.assertTrue(Subscription.objects.filter(user=self.member,
                        type=SubscriptionType.MEMBRE, active=True).exists())
        p = Payment.objects.get(id=r.data["payment_id"])
        self.assertIsNone(p.swinmo_ref)                               # swinmo_ref NULL
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.MANUAL_PAYMENT).exists())

    def test_refund_is_negative(self):
        r = self.client.post("/api/admin/payments/refund/",
                             {"user_id": self.member.id, "amount": 5000, "reason": "erreur"},
                             format="json")
        p = Payment.objects.get(id=r.data["payment_id"])
        self.assertEqual(p.type, PaymentType.REMBOURSEMENT)
        self.assertEqual(p.amount, -5000)                             # RG-39

    def test_exoneration_amount_zero(self):
        r = self.client.post("/api/admin/payments/exonerate/",
                             {"user_id": self.member.id, "reason": "cas social"}, format="json")
        p = Payment.objects.get(id=r.data["payment_id"])
        self.assertEqual(p.amount, 0)                                 # RG-40
        self.assertEqual(p.type, PaymentType.COTISATION)

    def test_dashboard_kpis(self):
        r = self.client.get("/api/admin/dashboard/")
        self.assertIn("revenue_month", r.data)
        self.assertIn("reports_pending", r.data)

    def test_export_members_csv(self):
        r = self.client.get("/api/admin/exports/members.csv")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "text/csv")
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.EXPORT_DATA).exists())


class ContentAdminTests(AdminBase):
    def test_create_formation_module_course_resource(self):
        rf = self.client.post("/api/admin/formations/", {
            "title": "Programme", "category": "FORMATION",
            "access_subscription_types": ["MEMBRE"], "status": "PUBLISHED",
        }, format="json")
        self.assertEqual(rf.status_code, 201)
        rm = self.client.post("/api/admin/modules/", {
            "formation": rf.data["id"], "title": "Module 1", "order": 1,
        }, format="json")
        self.assertEqual(rm.status_code, 201)
        rc = self.client.post("/api/admin/courses/", {
            "module": rm.data["id"], "title": "Cours 1", "order": 1,
        }, format="json")
        self.assertEqual(rc.status_code, 201)
        rr = self.client.post("/api/admin/resources/", {
            "course": rc.data["id"], "resource_type": "VIDEO",
            "video_source": "YOUTUBE", "youtube_url": "https://youtu.be/x", "title": "Intro",
        }, format="json")
        self.assertEqual(rr.status_code, 201)

    def test_youtube_resource_requires_url(self):
        f = Formation.objects.create(title="F", category=Category.FORMATION)
        m = Module.objects.create(formation=f, title="M", order=1)
        c = Course.objects.create(module=m, title="C", order=1)
        r = self.client.post("/api/admin/resources/", {
            "course": c.id, "resource_type": "VIDEO", "video_source": "YOUTUBE", "title": "x",
        }, format="json")
        self.assertEqual(r.status_code, 400)

    def test_create_quiz_with_nested_questions(self):
        f = Formation.objects.create(title="F", category=Category.FORMATION)
        m = Module.objects.create(formation=f, title="M", order=1)
        c = Course.objects.create(module=m, title="C", order=1)
        r = self.client.post("/api/admin/quizzes/", {
            "course": c.id, "title": "QCM", "pass_threshold": 15,
            "questions": [{
                "text": "Q1", "order": 1,
                "choices": [{"text": "bonne", "is_correct": True, "order": 1},
                            {"text": "mauvaise", "is_correct": False, "order": 2}],
            }],
        }, format="json")
        self.assertEqual(r.status_code, 201)
        quiz = Quiz.objects.get(id=r.data["id"])
        self.assertEqual(quiz.questions.count(), 1)
        self.assertEqual(Choice.objects.filter(question__quiz=quiz).count(), 2)

    def test_quiz_requires_course_xor_formation(self):
        f = Formation.objects.create(title="F", category=Category.FORMATION)
        m = Module.objects.create(formation=f, title="M", order=1)
        c = Course.objects.create(module=m, title="C", order=1)
        r = self.client.post("/api/admin/quizzes/", {
            "course": c.id, "formation": f.id, "title": "QCM",
        }, format="json")
        self.assertEqual(r.status_code, 400)

    def test_formation_logical_delete_unpublishes(self):
        f = Formation.objects.create(title="F", category=Category.FORMATION, status=FormationStatus.PUBLISHED)
        r = self.client.delete(f"/api/admin/formations/{f.id}/")
        self.assertEqual(r.status_code, 204)
        f.refresh_from_db()
        self.assertEqual(f.status, FormationStatus.DRAFT)             # RG-20 (dépubliée)
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.DELETE_CONTENT).exists())

    def test_scheduled_formation_requires_publish_at(self):
        r = self.client.post("/api/admin/formations/", {
            "title": "Programmé", "category": "FORMATION", "status": "SCHEDULED",
        }, format="json")
        self.assertEqual(r.status_code, 400)

    def test_publish_action_sets_published(self):
        f = Formation.objects.create(title="F", category=Category.FORMATION, status=FormationStatus.DRAFT)
        r = self.client.post(f"/api/admin/formations/{f.id}/publish/")
        self.assertEqual(r.status_code, 200)
        f.refresh_from_db()
        self.assertEqual(f.status, FormationStatus.PUBLISHED)

    def test_reset_quiz_requires_reason_and_audits(self):
        f = Formation.objects.create(title="F", category=Category.FORMATION)
        m = Module.objects.create(formation=f, title="M", order=1)
        c = Course.objects.create(module=m, title="C", order=1)
        quiz = Quiz.objects.create(course=c, title="QCM")
        QuizResult.objects.create(user=self.member, quiz=quiz, score=18, validated=True, attempts=2)
        r = self.client.post("/api/admin/quiz/reset/",
                             {"user_id": self.member.id, "quiz_id": quiz.id, "reason": "triche"}, format="json")
        self.assertEqual(r.status_code, 200)
        qr = QuizResult.objects.get(user=self.member, quiz=quiz)
        self.assertFalse(qr.validated)
        self.assertEqual(qr.score, 0)                                 # RG-27
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.RESET_QUIZ).exists())


# ════════════════════════════════════════════════════════════════════════════
#  CRUD RESSOURCES — mis en exergue (§5.4, RG-16/17)
#  Cycle de vie complet d'une ressource de cours : création (lien YouTube ET
#  fichier hébergé), listage filtré, détail, remplacement (PUT), modification
#  partielle / réordonnancement (PATCH), prévisualisation, suppression — chaque
#  écriture étant journalisée à l'audit.
# ════════════════════════════════════════════════════════════════════════════
class ResourceCrudTests(AdminBase):
    def setUp(self):
        super().setUp()
        self.formation = Formation.objects.create(title="Programme", category=Category.FORMATION)
        self.module = Module.objects.create(formation=self.formation, title="Module 1", order=1)
        self.course = Course.objects.create(module=self.module, title="Cours 1", order=1)
        self.url = "/api/admin/resources/"

    def _create_youtube(self, title="Intro", order=1):
        return self.client.post(self.url, {
            "course": self.course.id, "resource_type": "VIDEO", "video_source": "YOUTUBE",
            "youtube_url": "https://www.youtube.com/watch?v=ScMzIvxBSi4",
            "title": title, "order": order,
        }, format="json")

    # ── CREATE ────────────────────────────────────────────────────────────────
    def test_create_youtube_resource_and_audits(self):
        r = self._create_youtube()
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["video_source"], "YOUTUBE")
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.UPDATE_CONTENT,
                        target_type="Resource", target_id=str(r.data["id"])).exists())

    def test_create_hosted_file_resource(self):
        r = self.client.post(self.url, {
            "course": self.course.id, "resource_type": "PDF", "title": "Support",
            "bucket_key": "pdfs/abc_support.pdf", "nb_pages": 24, "size_mo": 1.8, "order": 2,
        }, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["bucket_key"], "pdfs/abc_support.pdf")

    def test_create_youtube_requires_url(self):
        r = self.client.post(self.url, {
            "course": self.course.id, "resource_type": "VIDEO", "video_source": "YOUTUBE", "title": "x",
        }, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("youtube_url", r.data)

    # ── READ (list filtré + détail) ─────────────────────────────────────────────
    def test_list_filtered_by_course(self):
        self._create_youtube(title="A", order=1)
        self._create_youtube(title="B", order=2)
        other = Course.objects.create(module=self.module, title="Autre", order=2)
        Resource.objects.create(course=other, resource_type="VIDEO",
                                video_source="YOUTUBE", youtube_url="https://youtu.be/z", title="Z")
        r = self.client.get(f"{self.url}?course={self.course.id}")
        self.assertEqual(r.status_code, 200)
        titles = [x["title"] for x in (r.data["results"] if "results" in r.data else r.data)]
        self.assertEqual(sorted(titles), ["A", "B"])

    def test_retrieve_resource(self):
        rid = self._create_youtube().data["id"]
        r = self.client.get(f"{self.url}{rid}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["id"], rid)

    # ── UPDATE (PUT complet + PATCH partiel) ────────────────────────────────────
    def test_put_replaces_and_switches_media(self):
        rid = self._create_youtube().data["id"]
        r = self.client.put(f"{self.url}{rid}/", {
            "course": self.course.id, "resource_type": "PDF", "title": "Devenu PDF",
            "bucket_key": "pdfs/new.pdf", "order": 1,
        }, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["resource_type"], "PDF")
        self.assertEqual(r.data["bucket_key"], "pdfs/new.pdf")

    def test_patch_reorders_resource(self):
        rid = self._create_youtube(order=1).data["id"]
        r = self.client.patch(f"{self.url}{rid}/", {"order": 5}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["order"], 5)
        Resource.objects.get(id=rid).refresh_from_db()
        self.assertEqual(Resource.objects.get(id=rid).order, 5)

    # ── PREVIEW (média hébergé) ─────────────────────────────────────────────────
    def test_preview_requires_hosted_file(self):
        rid = self._create_youtube().data["id"]  # YouTube → pas de fichier hébergé
        r = self.client.get(f"{self.url}{rid}/preview/")
        self.assertEqual(r.status_code, 400)

    # ── DELETE ──────────────────────────────────────────────────────────────────
    def test_delete_resource_and_audits(self):
        rid = self._create_youtube().data["id"]
        r = self.client.delete(f"{self.url}{rid}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(Resource.objects.filter(id=rid).exists())
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.DELETE_CONTENT,
                        target_type="Resource", target_id=str(rid)).exists())

    # ── PERMISSION ───────────────────────────────────────────────────────────────
    def test_member_cannot_crud_resources(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self._create_youtube().status_code, 403)


class ContentAuditTests(AdminBase):
    """La création/suppression de Module, Cours et QCM est journalisée (RG-21)."""
    def setUp(self):
        super().setUp()
        self.f = Formation.objects.create(title="F", category=Category.FORMATION)
        self.m = Module.objects.create(formation=self.f, title="M", order=1)
        self.c = Course.objects.create(module=self.m, title="C", order=1)

    def test_module_create_and_delete_audited(self):
        r = self.client.post("/api/admin/modules/",
                             {"formation": self.f.id, "title": "Mod", "order": 2}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.UPDATE_CONTENT,
                        target_type="Module", target_id=str(r.data["id"])).exists())
        self.client.delete(f"/api/admin/modules/{r.data['id']}/")
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.DELETE_CONTENT,
                        target_type="Module", target_id=str(r.data["id"])).exists())

    def test_course_create_and_update_audited(self):
        r = self.client.post("/api/admin/courses/",
                             {"module": self.m.id, "title": "Crs", "order": 2}, format="json")
        self.assertEqual(r.status_code, 201)
        self.client.patch(f"/api/admin/courses/{r.data['id']}/", {"order": 5}, format="json")
        self.assertEqual(AuditLog.objects.filter(action=AuditAction.UPDATE_CONTENT,
                         target_type="Course", target_id=str(r.data["id"])).count(), 2)

    def test_quiz_create_and_delete_audited(self):
        r = self.client.post("/api/admin/quizzes/",
                             {"course": self.c.id, "title": "QCM", "pass_threshold": 10}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.UPDATE_CONTENT,
                        target_type="Quiz", target_id=str(r.data["id"])).exists())
        self.client.delete(f"/api/admin/quizzes/{r.data['id']}/")
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.DELETE_CONTENT,
                        target_type="Quiz", target_id=str(r.data["id"])).exists())


class ModerationTests(AdminBase):
    def test_delete_post_cascade(self):
        author = User.objects.create_user("au@z.com", "Passw0rd!", full_name="Au",
                                          email_verified=True, status=UserStatus.ACTIF)
        post = Post.objects.create(author=author, text="x", audience=Audience.TOUS, likes_count=2)
        Comment.objects.create(post=post, author=author, text="c")
        Like.objects.create(post=post, user=self.member)
        r = self.client.post(f"/api/admin/posts/{post.id}/delete/", {"reason": "spam"}, format="json")
        self.assertEqual(r.status_code, 200)
        post.refresh_from_db()
        self.assertFalse(post.active)                                 # RG-33
        self.assertEqual(post.likes_count, 0)
        self.assertFalse(Comment.objects.filter(post=post, active=True).exists())
        self.assertFalse(Like.objects.filter(post=post).exists())
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.DELETE_POST).exists())

    def test_handle_report_marks_handled_and_audits(self):
        from apps.community.models import Report
        author = User.objects.create_user("rep@z.com", "Passw0rd!", full_name="Rp",
                                           email_verified=True, status=UserStatus.ACTIF)
        post = Post.objects.create(author=author, text="x", audience=Audience.TOUS)
        report = Report.objects.create(reporter=self.member, target_type=Report.TargetType.POST,
                                       target_id=post.id, reason="abus")
        r = self.client.post(f"/api/admin/reports/{report.id}/handle/",
                             {"reason": "Vérifié, sans suite"}, format="json")
        self.assertEqual(r.status_code, 200)
        report.refresh_from_db()
        self.assertTrue(report.handled)
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.RESOLVE_REPORT,
                        target_type="Report", target_id=str(report.id)).exists())

    def test_audit_log_is_append_only_via_orm(self):
        log = AuditLog.objects.create(actor=self.admin, action=AuditAction.WARN_USER)
        with self.assertRaises(PermissionError):
            log.reason = "x"
            log.save()
        with self.assertRaises(PermissionError):
            log.delete()

"""Tests unitaires + intégration de l'agent IA (IA-B1 à IA-B9).

À lancer en Docker :
    docker exec zola-ashe-backend-backend-1 pytest apps/ai_quiz/ -v
ou :
    docker exec zola-ashe-backend-backend-1 python manage.py test apps.ai_quiz -v 2

Les appels Gemini réels sont TOUJOURS mockés — ces tests tournent sans clé.
"""
from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.content.models import Formation, Module

from .models import (
    AIQROAnswer,
    AIQuestion,
    AIQuizJob,
    DifficultyLevel,
    JobStatus,
    QROVerdict,
    QuestionKind,
    SourceType,
)
from .prompts import (
    PromptValidationError,
    validate_generation_output,
    validate_level_classification_output,
    validate_qro_evaluation_output,
)

User = get_user_model()


# --- Fixtures partagées -----------------------------------------------------

def make_admin(email: str = "admin@zola.test") -> User:
    from apps.accounts.models import Role
    return User.objects.create_user(
        email=email, password="pwd12345", role=Role.ADMIN
    )


def make_member(email: str = "member@zola.test") -> User:
    return User.objects.create_user(email=email, password="pwd12345")


_FORMATION_COUNTER = 0


def make_module(title: str = "Test module") -> Module:
    global _FORMATION_COUNTER
    _FORMATION_COUNTER += 1
    formation = Formation.objects.create(
        title=f"Test formation {_FORMATION_COUNTER}",
        slug=f"test-formation-{_FORMATION_COUNTER}",
    )
    return Module.objects.create(formation=formation, title=title)


# --- 1) Validateurs de prompts (pure) --------------------------------------

class PromptValidatorsTest(TestCase):

    def test_generation_valid(self):
        data = {
            "questions": [
                {"kind": "QCM", "text": "Q1?", "choices": ["a", "b", "c", "d"],
                 "correct_index": 1},
                {"kind": "QRO", "text": "Explique.", "criteria": ["Doit citer X", "Doit expliquer Y"]},
            ]
        }
        out = validate_generation_output(data, expected_total=2)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["choices"], ["a", "b", "c", "d"])
        self.assertEqual(out[1]["criteria"], ["Doit citer X", "Doit expliquer Y"])

    def test_generation_rejects_qcm_wrong_choice_count(self):
        data = {"questions": [
            {"kind": "QCM", "text": "?", "choices": ["a", "b", "c"], "correct_index": 0}
        ]}
        with self.assertRaises(PromptValidationError):
            validate_generation_output(data)

    def test_generation_rejects_qcm_index_out_of_range(self):
        data = {"questions": [
            {"kind": "QCM", "text": "?", "choices": ["a", "b", "c", "d"], "correct_index": 5}
        ]}
        with self.assertRaises(PromptValidationError):
            validate_generation_output(data)

    def test_generation_rejects_qro_single_criterion(self):
        data = {"questions": [
            {"kind": "QRO", "text": "?", "criteria": ["un seul"]}
        ]}
        with self.assertRaises(PromptValidationError):
            validate_generation_output(data)

    def test_qro_eval_valid(self):
        out = validate_qro_evaluation_output(
            {"verdict": "VALIDATED", "score": 17, "justification": "bonne synthèse"}
        )
        self.assertEqual(out["score"], 17)

    def test_qro_eval_rejects_bad_verdict(self):
        with self.assertRaises(PromptValidationError):
            validate_qro_evaluation_output(
                {"verdict": "ABSTAIN", "score": 10, "justification": "x"}
            )

    def test_level_classification_valid(self):
        out = validate_level_classification_output(
            {"level": "INTERMEDIAIRE", "reason": "structuré"}
        )
        self.assertEqual(out["level"], "INTERMEDIAIRE")


# --- 2) Extracteur YouTube --------------------------------------------------

class YoutubeExtractorTest(TestCase):

    def test_extract_id_various_formats(self):
        from .extractors import extract_youtube_id
        for url, expected in [
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"),
            ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ]:
            self.assertEqual(extract_youtube_id(url), expected)

    def test_extract_id_rejects_garbage(self):
        from .extractors import extract_youtube_id
        with self.assertRaises(ValueError):
            extract_youtube_id("https://vimeo.com/12345")

    def test_extract_transcript_fails_when_oauth_not_configured(self):
        """Sans les 3 vars OAuth, TranscriptNotAvailable est levée avec
        un message actionable pointant vers le runbook (fail-safe RG-31)."""
        from django.test import override_settings
        from .extractors.youtube import (
            TranscriptNotAvailable,
            extract_youtube_transcript,
        )
        with override_settings(
            YOUTUBE_OAUTH_CLIENT_ID="",
            YOUTUBE_OAUTH_CLIENT_SECRET="",
            YOUTUBE_OAUTH_REFRESH_TOKEN="",
        ):
            with self.assertRaises(TranscriptNotAvailable) as ctx:
                extract_youtube_transcript("https://youtu.be/dQw4w9WgXcQ")
            msg = str(ctx.exception)
            self.assertIn("OAuth YouTube non configuré", msg)
            self.assertIn("SETUP_YOUTUBE_OFFICIAL_API.md", msg)

    def test_srt_parser_strips_indexes_timings_and_tags(self):
        """_srt_to_plain_text retire séquences, timings, tags inline et brackets."""
        from .extractors.youtube import _srt_to_plain_text
        srt = (
            "1\n"
            "00:00:00,000 --> 00:00:03,500\n"
            "Bonjour <c>et</c> bienvenue.\n"
            "\n"
            "2\n"
            "00:00:03,500 --> 00:00:07,000\n"
            "[Musique] On commence.\n"
        )
        self.assertEqual(
            _srt_to_plain_text(srt), "Bonjour et bienvenue. On commence."
        )

    def test_pick_caption_track_prefers_french(self):
        """Priorité fr → en → fallback : sélectionne la piste FR quand dispo."""
        from .extractors.youtube import _pick_caption_track

        class _Resp:
            def __init__(self, items):
                self.items = items
            def execute(self):
                return {"items": self.items}

        class _Captions:
            def __init__(self, items):
                self.items = items
            def list(self, **kw):
                return _Resp(self.items)

        class _Service:
            def __init__(self, items):
                self._items = items
            def captions(self):
                return _Captions(self._items)

        service = _Service([
            {"id": "en1", "snippet": {"language": "en", "trackKind": ""}},
            {"id": "fr1", "snippet": {"language": "fr", "trackKind": ""}},
        ])
        caption_id, lang = _pick_caption_track(service, "abc", ["fr", "en"])
        self.assertEqual(caption_id, "fr1")
        self.assertEqual(lang, "fr")

    def test_pick_caption_track_returns_none_when_no_tracks(self):
        """Vidéo sans sous-titres → (None, None) → l'appelant lève TranscriptNotAvailable."""
        from .extractors.youtube import _pick_caption_track

        class _Service:
            def captions(self):
                class _C:
                    def list(self, **kw):
                        class _R:
                            def execute(self):
                                return {"items": []}
                        return _R()
                return _C()

        caption_id, lang = _pick_caption_track(_Service(), "abc", ["fr"])
        self.assertIsNone(caption_id)
        self.assertIsNone(lang)


# --- 3) Endpoint POST /api/admin/quiz/generate-ai/ (IA-B6) -----------------

class GenerateQuizEndpointTest(TestCase):

    def setUp(self):
        self.admin = make_admin()
        self.member = make_member()
        self.module = make_module()
        self.client = APIClient()

    def test_requires_authentication(self):
        r = self.client.post(reverse("ai-generate-quiz"), {}, format="json")
        self.assertIn(r.status_code, (401, 403))

    def test_requires_admin_role(self):
        self.client.force_authenticate(self.member)
        r = self.client.post(reverse("ai-generate-quiz"), {}, format="json")
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_manual_text_creates_pending_job(self):
        self.client.force_authenticate(self.admin)
        with patch("apps.ai_quiz.views.generate_quiz_task") as mock_task:
            r = self.client.post(reverse("ai-generate-quiz"), {
                "module_id": self.module.id,
                "source_type": "MANUAL_TEXT",
                "source_text": "Texte source d'au moins quelques mots.",
                "nb_questions": 4,
                "difficulty": "FACILE",
            }, format="json")
        self.assertEqual(r.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(r.data["status"], "PENDING")
        mock_task.delay.assert_called_once()

    def test_manual_text_requires_source_text(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(reverse("ai-generate-quiz"), {
            "module_id": self.module.id,
            "source_type": "MANUAL_TEXT",
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("source_text", r.data)

    def test_youtube_requires_source_ref(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(reverse("ai-generate-quiz"), {
            "module_id": self.module.id,
            "source_type": "VIDEO_YOUTUBE",
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_module_rejected(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(reverse("ai-generate-quiz"), {
            "module_id": 999999,
            "source_type": "MANUAL_TEXT",
            "source_text": "x" * 100,
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


# --- 4) Endpoint GET /api/admin/quiz/generate-ai/<job_id>/ (IA-B7) ---------

class GenerationStatusEndpointTest(TestCase):

    def setUp(self):
        self.admin = make_admin()
        self.module = make_module()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_returns_job_with_questions(self):
        job = AIQuizJob.objects.create(
            module=self.module,
            source_type=SourceType.MANUAL_TEXT,
            source_text="x" * 100,
            status=JobStatus.DONE,
            suggested_level=DifficultyLevel.FACILE,
            suggested_rank=1,
        )
        AIQuestion.objects.create(
            job=job, kind=QuestionKind.QCM, text="?",
            choices=["a", "b", "c", "d"], correct_index=0, order=0,
        )
        r = self.client.get(
            reverse("ai-generate-quiz-status", kwargs={"job_id": str(job.id)})
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "DONE")
        self.assertEqual(r.data["suggested_level"], "FACILE")
        self.assertEqual(len(r.data["questions"]), 1)

    def test_404_on_unknown_job(self):
        r = self.client.get(
            reverse("ai-generate-quiz-status",
                    kwargs={"job_id": "00000000-0000-0000-0000-000000000000"})
        )
        self.assertEqual(r.status_code, 404)


# --- 5) Endpoint POST /api/quiz/<qid>/submit-qro/ (IA-B9) ------------------

class SubmitQROEndpointTest(TestCase):

    def setUp(self):
        self.member = make_member()
        self.admin = make_admin()
        self.module = make_module()
        self.job = AIQuizJob.objects.create(
            module=self.module,
            source_type=SourceType.MANUAL_TEXT,
            source_text="Le concept X signifie Y.",
            status=JobStatus.DONE,
        )
        self.qro = AIQuestion.objects.create(
            job=self.job,
            kind=QuestionKind.QRO,
            text="Définis le concept X.",
            criteria=["Doit citer Y", "Doit être clair"],
            is_published=True,
            order=0,
        )
        self.client = APIClient()

    def _url(self, qid=None):
        return reverse("ai-submit-qro", kwargs={"question_id": qid or self.qro.id})

    def test_requires_authentication(self):
        r = self.client.post(self._url(), {"answer_text": "..."}, format="json")
        self.assertIn(r.status_code, (401, 403))

    def test_404_if_not_published(self):
        self.qro.is_published = False
        self.qro.save()
        self.client.force_authenticate(self.member)
        r = self.client.post(self._url(), {"answer_text": "..."}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_404_if_not_qro(self):
        qcm = AIQuestion.objects.create(
            job=self.job, kind=QuestionKind.QCM, text="?",
            choices=["a", "b", "c", "d"], correct_index=0,
            is_published=True, order=1,
        )
        self.client.force_authenticate(self.member)
        r = self.client.post(self._url(qcm.id), {"answer_text": "..."}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_happy_path_stores_ai_verdict(self):
        self.client.force_authenticate(self.member)
        with patch("apps.ai_quiz.views.generate_json") as mock_gen:
            mock_gen.return_value = {
                "verdict": "VALIDATED",
                "score": 18,
                "justification": "Bonne réponse.",
            }
            r = self.client.post(
                self._url(),
                {"answer_text": "Le concept X signifie Y."},
                format="json",
            )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["verdict"], "VALIDATED")
        self.assertEqual(r.data["score"], 18)
        answer = AIQROAnswer.objects.get(question=self.qro, user=self.member)
        self.assertEqual(answer.verdict, "VALIDATED")

    def test_gemini_failure_falls_back_to_needs_review(self):
        from .gemini_client import AIGenerationError
        self.client.force_authenticate(self.member)
        with patch("apps.ai_quiz.views.generate_json") as mock_gen:
            mock_gen.side_effect = AIGenerationError("timeout")
            r = self.client.post(
                self._url(), {"answer_text": "réponse"}, format="json"
            )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["verdict"], "NEEDS_REVIEW")
        self.assertEqual(r.data["score"], 0)

    def test_resubmit_overwrites_previous_answer(self):
        AIQROAnswer.objects.create(
            question=self.qro, user=self.member,
            answer_text="premier essai", verdict=QROVerdict.REJECTED, score=5,
            justification="incomplet",
        )
        self.client.force_authenticate(self.member)
        with patch("apps.ai_quiz.views.generate_json") as mock_gen:
            mock_gen.return_value = {
                "verdict": "VALIDATED", "score": 16, "justification": "mieux."
            }
            r = self.client.post(
                self._url(), {"answer_text": "réponse améliorée"}, format="json"
            )
        self.assertEqual(r.status_code, 200)
        # Toujours une seule réponse en base.
        self.assertEqual(
            AIQROAnswer.objects.filter(question=self.qro, user=self.member).count(),
            1,
        )
        answer = AIQROAnswer.objects.get(question=self.qro, user=self.member)
        self.assertEqual(answer.answer_text, "réponse améliorée")
        self.assertEqual(answer.verdict, "VALIDATED")

    def test_409_if_admin_already_decided(self):
        AIQROAnswer.objects.create(
            question=self.qro, user=self.member,
            answer_text="ma réponse", verdict=QROVerdict.NEEDS_REVIEW, score=10,
            justification="ambigu",
            admin_decision=QROVerdict.VALIDATED,
        )
        self.client.force_authenticate(self.member)
        r = self.client.post(self._url(), {"answer_text": "encore"}, format="json")
        self.assertEqual(r.status_code, 409)


# --- 6) Compute rank algorithm ---------------------------------------------

class ComputeRankTest(TestCase):

    def test_rank_reflects_ordering(self):
        from apps.content.models import Branche

        from .tasks import _compute_rank

        formation = Formation.objects.create(
            title="F", slug="f", branch=Branche.MEMBRE,
        )
        mod = Module.objects.create(formation=formation, title="new")

        # 2 pairs déjà DONE avec des niveaux mixtes.
        f2 = Formation.objects.create(
            title="F2", slug="f2", branch=Branche.MEMBRE,
        )
        m2 = Module.objects.create(formation=f2, title="peer easy")
        m3 = Module.objects.create(formation=f2, title="peer hard")
        AIQuizJob.objects.create(
            module=m2, source_type=SourceType.MANUAL_TEXT,
            status=JobStatus.DONE, suggested_level=DifficultyLevel.FACILE,
        )
        AIQuizJob.objects.create(
            module=m3, source_type=SourceType.MANUAL_TEXT,
            status=JobStatus.DONE, suggested_level=DifficultyLevel.DIFFICILE,
        )
        # Le job qu'on classe.
        job = AIQuizJob.objects.create(
            module=mod, source_type=SourceType.MANUAL_TEXT,
            status=JobStatus.IN_PROGRESS,
        )
        # FACILE → 1 pair de niveau ≤ (l'autre FACILE) + 1 = 2.
        rank_facile = _compute_rank(job, "MEMBRE", "FACILE")
        # INTERMEDIAIRE → 1 pair de niveau ≤ (FACILE) + 1 = 2.
        rank_inter = _compute_rank(job, "MEMBRE", "INTERMEDIAIRE")
        # DIFFICILE → 2 pairs de niveau ≤ (les deux) + 1 = 3.
        rank_hard = _compute_rank(job, "MEMBRE", "DIFFICILE")
        self.assertEqual(rank_facile, 2)
        self.assertEqual(rank_inter, 2)
        self.assertEqual(rank_hard, 3)


# --- 7) File de revue admin QRO (IA-B10) -----------------------------------

class QROReviewEndpointsTest(TestCase):

    def setUp(self):
        self.admin = make_admin()
        self.member = make_member()
        self.module = make_module()
        self.job = AIQuizJob.objects.create(
            module=self.module,
            source_type=SourceType.MANUAL_TEXT,
            source_text="Source.",
            status=JobStatus.DONE,
        )
        self.qro = AIQuestion.objects.create(
            job=self.job, kind=QuestionKind.QRO, text="Q?",
            criteria=["A", "B"], is_published=True, order=0,
        )
        self.pending = AIQROAnswer.objects.create(
            question=self.qro, user=self.member,
            answer_text="ambigu",
            verdict=QROVerdict.NEEDS_REVIEW, score=10,
            justification="ambigu",
        )
        # Une autre answer déjà tranchée → doit être exclue de la liste.
        self.decided = AIQROAnswer.objects.create(
            question=self.qro, user=make_member("m2@zola.test"),
            answer_text="ok",
            verdict=QROVerdict.NEEDS_REVIEW, score=12, justification="j",
            admin_decision=QROVerdict.VALIDATED,
        )
        self.client = APIClient()

    def test_list_requires_admin(self):
        self.client.force_authenticate(self.member)
        r = self.client.get(reverse("ai-qro-review-list"))
        self.assertEqual(r.status_code, 403)

    def test_list_only_shows_pending(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(reverse("ai-qro-review-list"))
        self.assertEqual(r.status_code, 200)
        # Pagination éventuelle : ids retournés = uniquement pending.
        results = r.data.get("results", r.data)
        ids = [row["id"] for row in results]
        self.assertIn(self.pending.id, ids)
        self.assertNotIn(self.decided.id, ids)

    def test_list_filter_by_question_id(self):
        other_qro = AIQuestion.objects.create(
            job=self.job, kind=QuestionKind.QRO, text="Autre Q?",
            criteria=["C", "D"], is_published=True, order=1,
        )
        AIQROAnswer.objects.create(
            question=other_qro, user=self.member, answer_text="x",
            verdict=QROVerdict.NEEDS_REVIEW, score=8, justification="j",
        )
        self.client.force_authenticate(self.admin)
        r = self.client.get(
            reverse("ai-qro-review-list"),
            {"question_id": str(self.qro.id)},
        )
        results = r.data.get("results", r.data)
        for row in results:
            self.assertEqual(row["question"], self.qro.id)

    def test_decide_writes_admin_fields(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            reverse("ai-qro-review-decide", kwargs={"answer_id": self.pending.id}),
            {"decision": "VALIDATED", "note": "OK malgré ambiguïté"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.admin_decision, "VALIDATED")
        self.assertEqual(self.pending.admin_decided_by, self.admin)
        self.assertIsNotNone(self.pending.admin_decided_at)
        self.assertEqual(self.pending.admin_note, "OK malgré ambiguïté")

    def test_decide_409_if_already_decided(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            reverse("ai-qro-review-decide", kwargs={"answer_id": self.decided.id}),
            {"decision": "REJECTED"},
            format="json",
        )
        self.assertEqual(r.status_code, 409)

    def test_decide_rejects_non_admin(self):
        self.client.force_authenticate(self.member)
        r = self.client.post(
            reverse("ai-qro-review-decide", kwargs={"answer_id": self.pending.id}),
            {"decision": "VALIDATED"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)

    def test_decide_rejects_invalid_choice(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            reverse("ai-qro-review-decide", kwargs={"answer_id": self.pending.id}),
            {"decision": "MAYBE"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

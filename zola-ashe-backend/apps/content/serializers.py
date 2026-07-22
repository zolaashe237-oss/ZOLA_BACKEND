"""Serializers du contenu (lecture membre).

`bucket_key` n'est jamais exposé : les fichiers hébergés passent par l'endpoint
de streaming signé (RG-17/19). Les bonnes réponses d'un QCM ne sont jamais
exposées : la notation est faite côté serveur.
"""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Audio, Choice, Course, Formation, LibraryPdf, LiveSession, Module, Question, Quiz, QuizResult, Resource
from .services import (
    course_state,
    final_exam_unlocked,
    formation_accessible,
    generate_signed_url,
    module_state,
)


def _thumbnail(obj) -> str:
    """URL signée de la miniature (MinIO) ou miniature externe en repli."""
    if getattr(obj, "thumbnail_key", ""):
        return generate_signed_url(obj.thumbnail_key)
    return getattr(obj, "thumbnail_url", "") or ""


# ─── Arbre : ressources, cours, modules ─────────────────────────────────────

def serialize_resource(resource: Resource, *, unlocked: bool) -> dict:
    """Ressource pour un membre. Le lien YouTube/le média n'est exposé que si le
    cours est déverrouillé ; sinon on n'envoie que les métadonnées d'aperçu."""
    return {
        "id": resource.id,
        "resource_type": resource.resource_type,
        "title": resource.title,
        "description": resource.description,
        "order": resource.order,
        "is_youtube": resource.is_youtube,
        "thumbnail": _thumbnail(resource),
        "nb_pages": resource.nb_pages,
        "duration_sec": resource.duration_sec,
        "stream_available": bool(resource.bucket_key),
        # YouTube : lien public, mais on respecte le déblocage par progression.
        "youtube_url": resource.youtube_url if (unlocked and resource.is_youtube) else "",
    }


def serialize_course(course: Course, *, user, accessible: bool) -> dict:
    """Cours + ses ressources + son QCM (résumé)."""
    state = course_state(user, course, accessible)
    unlocked = not state["locked"]
    quiz = getattr(course, "quiz", None)
    return {
        "id": course.id,
        "title": course.title,
        "description": course.description,
        "order": course.order,
        "access": {"locked": state["locked"], "lock_reason": state["lock_reason"]},
        "completed": state["completed"],
        "resources": [serialize_resource(r, unlocked=unlocked) for r in course.resources.all()],
        "quiz": ({"id": quiz.id, "title": quiz.title, "question_count": quiz.questions.count(),
                  "pass_threshold": quiz.pass_threshold}
                 if quiz and quiz.active else None),
    }


def serialize_module(module: Module, *, user, accessible: bool) -> dict:
    """Module + ses cours + ses sous-modules (récursif)."""
    state = module_state(user, module, accessible)
    return {
        "id": module.id,
        "title": module.title,
        "description": module.description,
        "order": module.order,
        "access": {"locked": state["locked"], "lock_reason": state["lock_reason"]},
        "completed": state["completed"],
        "courses": [serialize_course(c, user=user, accessible=accessible)
                    for c in module.courses.all()],
        "children": [serialize_module(child, user=user, accessible=accessible)
                     for child in module.children.all()],
    }


# ─── Formations ──────────────────────────────────────────────────────────────

class FormationListSerializer(serializers.ModelSerializer):
    cover = serializers.SerializerMethodField()
    is_reserved = serializers.BooleanField(read_only=True)
    locked = serializers.SerializerMethodField()
    module_count = serializers.SerializerMethodField()

    class Meta:
        model = Formation
        fields = ("id", "slug", "title", "description", "category", "branch", "level",
                  "cover", "is_reserved", "locked", "module_count")

    def get_cover(self, obj) -> str:
        url = generate_signed_url(obj.cover_key) if obj.cover_key else obj.cover_url
        if url and url.startswith("/"):
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(url)
        return url or ""

    def get_locked(self, obj) -> bool:
        types = self.context.get("accessible_sub_types")
        return not formation_accessible(self.context["request"].user, obj, accessible_types=types)

    def get_module_count(self, obj) -> int:
        return obj.modules.count()


class FormationDetailSerializer(serializers.ModelSerializer):
    cover = serializers.SerializerMethodField()
    is_reserved = serializers.BooleanField(read_only=True)
    locked = serializers.SerializerMethodField()
    modules = serializers.SerializerMethodField()
    final_exam = serializers.SerializerMethodField()

    class Meta:
        model = Formation
        fields = ("id", "slug", "title", "description", "category", "branch", "level",
                  "cover", "is_reserved", "locked", "modules", "final_exam")

    def _accessible(self, obj) -> bool:
        types = self.context.get("accessible_sub_types")
        return formation_accessible(self.context["request"].user, obj, accessible_types=types)

    def get_cover(self, obj) -> str:
        return generate_signed_url(obj.cover_key) if obj.cover_key else obj.cover_url

    def get_locked(self, obj) -> bool:
        return not self._accessible(obj)

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_modules(self, obj):
        user = self.context["request"].user
        accessible = self._accessible(obj)
        roots = obj.modules.filter(parent__isnull=True)
        return [serialize_module(m, user=user, accessible=accessible) for m in roots]

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_final_exam(self, obj):
        exam = getattr(obj, "final_exam", None)
        if not exam or not exam.active:
            return None
        user = self.context["request"].user
        accessible = self._accessible(obj)
        unlocked = accessible and final_exam_unlocked(user, obj)
        result = QuizResult.objects.filter(user=user, quiz=exam).first()
        return {
            "id": exam.id,
            "title": exam.title,
            "question_count": exam.questions.count(),
            "pass_threshold": exam.pass_threshold,
            "locked": not unlocked,
            "lock_reason": None if unlocked else ("subscription" if not accessible else "quiz"),
            "validated": bool(result and result.validated),
            "score": result.score if result else None,
        }


# ─── QCM (passage) ───────────────────────────────────────────────────────────

class ChoicePublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Choice
        fields = ("id", "text")  # is_correct jamais exposé


class QuestionPublicSerializer(serializers.ModelSerializer):
    choices = ChoicePublicSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = ("id", "text", "multiple", "type", "criteria", "choices")


class QuizPublicSerializer(serializers.ModelSerializer):
    questions = QuestionPublicSerializer(many=True, read_only=True)

    class Meta:
        model = Quiz
        fields = ("id", "title", "pass_threshold", "is_final", "questions")


class QuizResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizResult
        fields = ("quiz", "score", "attempts", "validated", "validated_at")
        read_only_fields = fields


class QuizSubmitSerializer(serializers.Serializer):
    """Réponses du membre : {question_id: [choice_id, ...]} + QRO {question_id: texte}."""
    answers = serializers.DictField(
        child=serializers.ListField(child=serializers.IntegerField(), allow_empty=True),
    )
    qro_answers = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=dict,
    )


class LiveSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = LiveSession
        fields = ("id", "title", "description", "start_at", "duration_minutes",
                  "trainer", "platform", "status", "link", "replay_url",
                  "branche", "tags", "created_at")
        read_only_fields = fields


class LibraryPdfPublicSerializer(serializers.ModelSerializer):
    cover = serializers.SerializerMethodField()

    class Meta:
        model = LibraryPdf
        fields = ("id", "title", "description", "category", "branche",
                  "access_level", "cover", "nb_pages", "size_mo",
                  "is_gratuit", "created_at")

    def get_cover(self, obj) -> str:
        url = obj.cover_url or ""
        if url and url.startswith("/"):
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(url)
        return url


class AudioPublicSerializer(serializers.ModelSerializer):
    cover = serializers.SerializerMethodField()

    class Meta:
        model = Audio
        fields = ("id", "title", "description", "category", "branche",
                  "access_level", "cover", "duration_sec", "size_mo",
                  "audio_format", "is_gratuit", "created_at")

    def get_cover(self, obj) -> str:
        url = obj.cover_url or ""
        if url and url.startswith("/"):
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(url)
        return url

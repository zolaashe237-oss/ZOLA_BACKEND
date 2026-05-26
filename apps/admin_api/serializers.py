"""Serializers du back-office admin."""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.models import User
from apps.billing.serializers import PaymentSerializer, SubscriptionSerializer
from apps.content.models import (
    Choice,
    Course,
    Formation,
    Module,
    Question,
    Quiz,
    Resource,
)


# ─── Membres ────────────────────────────────────────────────────────────────

class MemberListSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "full_name", "role", "status",
                  "email_verified", "nb_warnings", "created_at", "last_login")


class MemberDetailSerializer(serializers.ModelSerializer):
    subscriptions = serializers.SerializerMethodField()
    payments = serializers.SerializerMethodField()
    quiz_results = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "photo", "role", "status",
                  "status_changed_at", "email_verified", "nb_warnings",
                  "created_at", "last_login", "subscriptions", "payments", "quiz_results")

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_subscriptions(self, obj):
        return SubscriptionSerializer(obj.subscriptions.all(), many=True).data

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_payments(self, obj):
        return PaymentSerializer(obj.payments.order_by("-paid_at"), many=True).data

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_quiz_results(self, obj):
        qs = obj.quiz_results.select_related("quiz")
        return [{"quiz": q.quiz_id, "title": q.quiz.title, "score": q.score,
                 "validated": q.validated} for q in qs]


# ─── Actions sur les membres ─────────────────────────────────────────────────

class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


# ─── Paiements admin (RG-06, RG-39, RG-40) ───────────────────────────────────

class ManualPaymentSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=["INSCRIPTION", "COTISATION", "DON"])
    amount = serializers.IntegerField(required=False, min_value=0)
    reason = serializers.CharField(max_length=255)


class RefundSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    amount = serializers.IntegerField(min_value=1)  # montant positif → stocké négatif
    reason = serializers.CharField(max_length=255)


class ExonerationSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    reason = serializers.CharField(max_length=255)


# ─── Catalogue : formations, modules, cours, ressources (RG-20, §5.4) ────────

def _validate_access_types(value):
    """Liste de types d'abonnement valides ([] = accès public)."""
    from apps.billing.models import SubscriptionType
    if not isinstance(value, list):
        raise serializers.ValidationError("Une liste de types d'abonnement est attendue.")
    valid = set(SubscriptionType.values)
    invalid = [v for v in value if v not in valid]
    if invalid:
        raise serializers.ValidationError(
            f"Types d'abonnement inconnus : {invalid}. Valides : {sorted(valid)}.")
    return value


class AdminFormationSerializer(serializers.ModelSerializer):
    module_count = serializers.SerializerMethodField()

    class Meta:
        model = Formation
        fields = ("id", "title", "description", "category", "access_subscription_types",
                  "cover_url", "cover_key", "status", "publish_at", "order",
                  "module_count", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def get_module_count(self, obj) -> int:
        return obj.modules.count()

    def validate_access_subscription_types(self, value):
        return _validate_access_types(value)

    def validate(self, attrs):
        """Une formation programmée exige une date de mise en ligne (§5.4)."""
        from apps.content.models import FormationStatus
        status_value = attrs.get("status") or getattr(self.instance, "status", None)
        publish_at = attrs.get("publish_at", getattr(self.instance, "publish_at", None))
        if status_value == FormationStatus.SCHEDULED and not publish_at:
            raise serializers.ValidationError(
                {"publish_at": "Une date de publication est requise pour une formation programmée."})
        return attrs


class AdminModuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = ("id", "formation", "parent", "title", "description", "order", "created_at")
        read_only_fields = ("id", "created_at")

    def validate(self, attrs):
        """Le parent doit appartenir à la même formation et ne pas être le module lui-même."""
        formation = attrs.get("formation") or getattr(self.instance, "formation", None)
        parent = attrs.get("parent") or getattr(self.instance, "parent", None)
        if parent is not None:
            if formation and parent.formation_id != formation.id:
                raise serializers.ValidationError(
                    {"parent": "Le module parent doit appartenir à la même formation."})
            if self.instance and parent.id == self.instance.id:
                raise serializers.ValidationError({"parent": "Un module ne peut être son propre parent."})
        return attrs


class AdminCourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = ("id", "module", "title", "description", "order", "created_at")
        read_only_fields = ("id", "created_at")


class AdminResourceSerializer(serializers.ModelSerializer):
    thumbnail = serializers.SerializerMethodField()

    class Meta:
        model = Resource
        fields = ("id", "course", "resource_type", "title", "description", "order",
                  "video_source", "youtube_url", "bucket_key", "thumbnail_url",
                  "thumbnail_key", "thumbnail", "nb_pages", "duration_sec", "size_mo",
                  "audio_format", "created_at")
        read_only_fields = ("id", "created_at")

    def get_thumbnail(self, obj) -> str:
        from apps.content.services import generate_signed_url
        if obj.thumbnail_key:
            return generate_signed_url(obj.thumbnail_key)
        return obj.thumbnail_url

    def validate(self, attrs):
        """Une vidéo YouTube exige une URL."""
        from apps.content.models import ResourceType, VideoSource
        rtype = attrs.get("resource_type") or getattr(self.instance, "resource_type", None)
        source = attrs.get("video_source", getattr(self.instance, "video_source", ""))
        youtube = attrs.get("youtube_url", getattr(self.instance, "youtube_url", ""))
        if rtype == ResourceType.VIDEO and source == VideoSource.YOUTUBE and not youtube:
            raise serializers.ValidationError(
                {"youtube_url": "Un lien YouTube est requis pour une vidéo de source YouTube."})
        return attrs


class UploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    content_type = serializers.ChoiceField(choices=["VIDEO", "PDF", "AUDIO", "IMAGE"])


# ─── QCM admin : édition imbriquée (questions + options) ──────────────────────

class AdminChoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Choice
        fields = ("id", "text", "is_correct", "order")
        read_only_fields = ("id",)


class AdminQuestionSerializer(serializers.ModelSerializer):
    choices = AdminChoiceSerializer(many=True)

    class Meta:
        model = Question
        fields = ("id", "text", "multiple", "order", "choices")
        read_only_fields = ("id",)


class AdminQuizSerializer(serializers.ModelSerializer):
    """QCM avec questions/options imbriquées (réécriture complète à l'update)."""
    questions = AdminQuestionSerializer(many=True, required=False)

    class Meta:
        model = Quiz
        fields = ("id", "course", "formation", "title", "pass_threshold", "active",
                  "questions", "created_at")
        read_only_fields = ("id", "created_at")

    def validate(self, attrs):
        course = attrs.get("course") or getattr(self.instance, "course", None)
        formation = attrs.get("formation") or getattr(self.instance, "formation", None)
        if bool(course) == bool(formation):
            raise serializers.ValidationError(
                "Un QCM est rattaché soit à un cours, soit à une formation (examen final).")
        return attrs

    def _save_questions(self, quiz, questions_data):
        quiz.questions.all().delete()  # réécriture complète
        for q in questions_data:
            choices = q.pop("choices", [])
            question = Question.objects.create(quiz=quiz, **q)
            Choice.objects.bulk_create([Choice(question=question, **c) for c in choices])

    def create(self, validated_data):
        questions_data = validated_data.pop("questions", [])
        quiz = Quiz.objects.create(**validated_data)
        self._save_questions(quiz, questions_data)
        return quiz

    def update(self, instance, validated_data):
        questions_data = validated_data.pop("questions", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if questions_data is not None:
            self._save_questions(instance, questions_data)
        return instance


class QuizScoreSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    quiz_id = serializers.IntegerField()
    score = serializers.IntegerField(min_value=0, max_value=20)


class ResetQuizSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    quiz_id = serializers.IntegerField()
    reason = serializers.CharField(max_length=255)


# ─── Publication admin (annonces) ────────────────────────────────────────────

class AdminPostSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    audience = serializers.ChoiceField(choices=["TOUS", "FEMME", "ENFANT"], default="TOUS")
    is_pinned = serializers.BooleanField(default=False)
    is_announcement = serializers.BooleanField(default=False)
    scheduled_at = serializers.DateTimeField(required=False, allow_null=True)

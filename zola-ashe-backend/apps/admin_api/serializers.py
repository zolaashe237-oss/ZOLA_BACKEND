"""Serializers du back-office admin."""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.models import User
from apps.billing.serializers import PaymentSerializer, SubscriptionSerializer
from apps.billing.models import Payment, PaymentType, PaymentStatus, SubscriptionPlan
from apps.community.models import CommunityChannel, Post
from apps.content.models import (
    Audio,
    Choice,
    Course,
    Formation,
    LibraryPdf,
    LiveSession,
    Module,
    Question,
    Quiz,
    Resource,
    QuizResult,
)


# ─── Membres ────────────────────────────────────────────────────────────────

class MemberListSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "full_name", "role", "status",
                  "email_verified", "nb_warnings", "created_at", "last_login",
                  "phone", "country", "access_levels")


class MemberDetailSerializer(serializers.ModelSerializer):
    subscriptions = serializers.SerializerMethodField()
    payments = serializers.SerializerMethodField()
    quiz_results = serializers.SerializerMethodField()
    formations_progress = serializers.SerializerMethodField()
    password = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "photo", "role", "status",
                  "status_changed_at", "email_verified", "nb_warnings",
                  "created_at", "last_login", "subscriptions", "payments", "quiz_results",
                  "formations_progress", "phone", "country", "access_levels", "password")
        read_only_fields = ("id", "status_changed_at", "created_at", "last_login", "nb_warnings")

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

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_formations_progress(self, obj):
        from apps.content.services import visible_formations_qs, module_completed
        from apps.content.models import Quiz, QuizResult
        
        progress = []
        for formation in visible_formations_qs():
            modules = formation.modules.all()
            modules_total = modules.count()
            modules_completed = 0
            for module in modules:
                if module_completed(obj, module):
                    modules_completed += 1
            
            progress_pct = int(round(modules_completed / modules_total * 100)) if modules_total > 0 else 0
            
            # Find the final exam score if it exists
            final_exam_quiz = Quiz.objects.filter(formation=formation).first()
            quiz_score = None
            if final_exam_quiz:
                quiz_result = QuizResult.objects.filter(user=obj, quiz=final_exam_quiz).first()
                if quiz_result:
                    quiz_score = quiz_result.score
                    
            progress.append({
                "formation_id": formation.id,
                "formation_title": formation.title,
                "progress_pct": progress_pct,
                "modules_completed": modules_completed,
                "modules_total": modules_total,
                "quiz_score": quiz_score,
                "completed": progress_pct == 100 and modules_total > 0
            })
        return progress

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User.objects.create(**validated_data)
        if password:
            user.set_password(password)
            user.save(update_fields=["password"])
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


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
    cover_url    = serializers.SerializerMethodField()
    # Nommage frontend admin : branche/niveau mappés sur les champs DB branch/level
    branche = serializers.CharField(source="branch", allow_blank=True, required=False)
    niveau  = serializers.CharField(source="level",  allow_blank=True, required=False)

    class Meta:
        model = Formation
        fields = ("id", "title", "description", "category", "branche", "niveau",
                  "access_subscription_types", "is_public", "cover_url", "cover_key",
                  "status", "publish_at", "order", "module_count", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def get_module_count(self, obj) -> int:
        return obj.modules.count()

    def get_cover_url(self, obj) -> str:
        from apps.content.services import generate_signed_url
        if obj.cover_key:
            url = generate_signed_url(obj.cover_key)
            # In local dev (USE_S3=False), generate_signed_url returns a relative
            # path like /media/.... Build an absolute URL so the frontend (on a
            # different port) can reach the file served by Django.
            if url and url.startswith("/"):
                request = self.context.get("request")
                if request:
                    url = request.build_absolute_uri(url)
            return url
        return obj.cover_url or ""

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
                  "audio_format", "transcript_text", "created_at")
        read_only_fields = ("id", "transcript_text", "created_at")

    def get_thumbnail(self, obj) -> str:
        from apps.content.services import generate_signed_url
        if obj.thumbnail_key:
            url = generate_signed_url(obj.thumbnail_key)
            if url and url.startswith("/"):
                request = self.context.get("request")
                if request:
                    url = request.build_absolute_uri(url)
            return url
        return obj.thumbnail_url or ""

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
        fields = ("id", "text", "multiple", "order", "type", "criteria", "choices")
        read_only_fields = ("id",)


class AdminQuizSerializer(serializers.ModelSerializer):
    """QCM avec questions/options imbriquées (réécriture complète à l'update)."""
    questions = AdminQuestionSerializer(many=True, required=False)
    status = serializers.SerializerMethodField()

    class Meta:
        model = Quiz
        fields = ("id", "course", "formation", "title", "pass_threshold", "active",
                  "questions", "created_at",
                  "generated_by_ai", "ai_source", "niveau", "rang", "status")
        read_only_fields = ("id", "created_at", "status")

    def get_status(self, obj) -> str:
        return "PUBLISHED" if obj.active else "DRAFT"

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


# ─── Transactions ────────────────────────────────────────────────────────────

class TransactionSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)
    kind = serializers.CharField(source="type", read_only=True)
    status = serializers.SerializerMethodField()
    amount = serializers.SerializerMethodField()
    currency = serializers.SerializerMethodField()
    payment_method = serializers.SerializerMethodField()
    reference = serializers.CharField(source="swinmo_ref", read_only=True)
    created_at = serializers.DateTimeField(source="paid_at", read_only=True)

    class Meta:
        model = Payment
        fields = (
            "id", "user_id", "user_name", "user_email", "kind", "status",
            "amount", "currency", "payment_method", "reference", "reason",
            "paid_at", "created_at"
        )

    def get_status(self, obj) -> str:
        if obj.status == PaymentStatus.VALIDE:
            if obj.type == PaymentType.REMBOURSEMENT:
                return "REMBOURSE"
            elif obj.type == PaymentType.COTISATION and obj.amount == 0:
                return "EXONERE"
            return "REUSSI"
        elif obj.status == PaymentStatus.EN_ATTENTE:
            return "EN_ATTENTE"
        elif obj.status == PaymentStatus.ECHOUE:
            return "ECHOUE"
        return obj.status

    def get_amount(self, obj) -> int:
        return abs(obj.amount)

    def get_currency(self, obj) -> str:
        return "XAF"

    def get_payment_method(self, obj) -> str:
        return "MANUEL" if not obj.swinmo_ref else "MTN_MOBILE_MONEY"


# ─── Résultats QCM ────────────────────────────────────────────────────────────

class AdminQuizResultSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)
    quiz_id = serializers.IntegerField(source="quiz.id", read_only=True)
    quiz_title = serializers.CharField(source="quiz.title", read_only=True)
    max_score = serializers.SerializerMethodField()
    passed_at = serializers.DateTimeField(source="validated_at", read_only=True)
    created_at = serializers.DateTimeField(source="validated_at", read_only=True)

    class Meta:
        model = QuizResult
        fields = (
            "id", "user_id", "user_name", "user_email", "quiz_id", "quiz_title",
            "score", "max_score", "validated", "attempts", "passed_at", "created_at"
        )

    def get_max_score(self, obj) -> int:
        return 20


# ─── Progression ─────────────────────────────────────────────────────────────

class ProgressionKpisSerializer(serializers.Serializer):
    total_enrollments = serializers.IntegerField()
    total_completions = serializers.IntegerField()
    avg_completion_rate = serializers.FloatField()
    avg_quiz_score = serializers.FloatField(allow_null=True)


class FormationProgressStatSerializer(serializers.Serializer):
    formation_id = serializers.IntegerField()
    formation_title = serializers.CharField()
    cover_url = serializers.CharField(allow_null=True, required=False)
    enrolled_count = serializers.IntegerField()
    completed_count = serializers.IntegerField()
    completion_rate = serializers.FloatField()
    avg_quiz_score = serializers.FloatField(allow_null=True)
    avg_progress_pct = serializers.FloatField()


class MemberProgressEntrySerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    user_name = serializers.CharField()
    user_email = serializers.CharField()
    formation_id = serializers.IntegerField()
    formation_title = serializers.CharField()
    progress_pct = serializers.IntegerField()
    modules_completed = serializers.IntegerField()
    modules_total = serializers.IntegerField()
    quiz_score = serializers.FloatField(allow_null=True)
    last_activity = serializers.DateTimeField(allow_null=True)
    completed = serializers.BooleanField()


# ─── Audio standalone ────────────────────────────────────────────────────────

class AdminAudioSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Audio
        fields = ("id", "title", "description", "category", "branche", "access_level",
                  "bucket_key", "file_url", "cover_url", "duration_sec", "size_mo",
                  "audio_format", "is_active", "is_gratuit", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def get_file_url(self, obj) -> str | None:
        if not obj.bucket_key:
            return None
        from apps.content.services import generate_signed_url
        url = generate_signed_url(obj.bucket_key)
        if url and url.startswith("/"):
            request = self.context.get("request")
            if request:
                url = request.build_absolute_uri(url)
        return url


# ─── Bibliothèque PDF standalone ─────────────────────────────────────────────

class AdminLibraryPdfSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = LibraryPdf
        fields = ("id", "title", "description", "category", "branche", "access_level",
                  "bucket_key", "file_url", "cover_url", "nb_pages", "size_mo",
                  "is_active", "is_gratuit", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def get_file_url(self, obj) -> str | None:
        if not obj.bucket_key:
            return None
        from apps.content.services import generate_signed_url
        url = generate_signed_url(obj.bucket_key)
        if url and url.startswith("/"):
            request = self.context.get("request")
            if request:
                url = request.build_absolute_uri(url)
        return url


# ─── Sessions en direct (admin) ───────────────────────────────────────────────

class AdminLiveSessionSerializer(serializers.ModelSerializer):
    scheduled_at = serializers.DateTimeField(source="start_at")
    replay_url   = serializers.URLField(allow_blank=True, allow_null=True, required=False)

    class Meta:
        model = LiveSession
        fields = ("id", "title", "description", "scheduled_at", "duration_minutes",
                  "trainer", "platform", "status", "link", "replay_url",
                  "branche", "tags", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_replay_url(self, value):
        # DB column is NOT NULL (blank=True) — convert None to empty string
        return value if value is not None else ""


# ─── Canaux communautaires ────────────────────────────────────────────────────

class AdminChannelSerializer(serializers.ModelSerializer):
    post_count = serializers.SerializerMethodField()

    class Meta:
        model = CommunityChannel
        fields = ("id", "name", "slug", "description", "branche", "color",
                  "is_active", "post_count", "created_at")
        read_only_fields = ("id", "created_at")

    def get_post_count(self, obj) -> int:
        return obj.posts.filter(active=True).count()


# ─── Posts communauté (admin) ─────────────────────────────────────────────────

class AdminCommunityPostSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)
    author_email = serializers.CharField(source="author.email", read_only=True)
    channel_name = serializers.SerializerMethodField()
    body = serializers.CharField(source="text", required=False, allow_blank=True)
    status = serializers.CharField(source="post_status")
    comment_count = serializers.SerializerMethodField()
    report_count = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = ("id", "author_name", "author_email", "channel", "channel_name",
                  "type", "title", "body", "is_pinned", "is_announcement",
                  "status", "comment_count", "report_count",
                  "created_at", "updated_at")
        read_only_fields = ("id", "author_name", "author_email", "channel_name",
                            "comment_count", "report_count", "created_at", "updated_at")

    def get_channel_name(self, obj) -> str | None:
        return obj.channel.name if obj.channel else None

    def get_comment_count(self, obj) -> int:
        return obj.comments.filter(active=True).count()

    def get_report_count(self, obj) -> int:
        from apps.community.models import Report
        return Report.objects.filter(target_type="POST", target_id=obj.id).count()


# ─── Plans d'abonnement ───────────────────────────────────────────────────────

class AdminSubscriptionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPlan
        fields = ("id", "kind", "name", "billing", "price_total", "nb_tranches",
                  "tranche_amount", "description", "is_active",
                  "access_levels", "formation_ids", "created_at", "updated_at")
        read_only_fields = ("id", "kind", "created_at", "updated_at")


# ─── Équipe admin ─────────────────────────────────────────────────────────────

class AdminTeamSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "photo", "role", "status",
                  "email_verified", "is_active", "created_at", "last_login",
                  "password")
        read_only_fields = ("id", "created_at", "last_login", "email_verified")

    def create(self, validated_data):
        from apps.accounts.models import Role
        password = validated_data.pop("password", None)
        validated_data["role"] = Role.ADMIN
        validated_data["email_verified"] = True
        user = User.objects.create(**validated_data)
        if password:
            user.set_password(password)
            user.save(update_fields=["password"])
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


# ─── Mémoires (demandes de rédaction) ────────────────────────────────────────

from apps.memoir.models import MemoirDraft  # noqa: E402


class AdminMemoirListSerializer(serializers.ModelSerializer):
    """Résumé d'une soumission pour la liste admin."""

    user_id      = serializers.IntegerField(source="user.id", read_only=True)
    user_name    = serializers.CharField(source="user.full_name", read_only=True)
    user_email   = serializers.EmailField(source="user.email", read_only=True)
    user_phone   = serializers.CharField(source="user.phone", allow_null=True, read_only=True)
    user_country = serializers.CharField(source="user.country", allow_null=True, read_only=True)
    answers_count = serializers.SerializerMethodField()

    class Meta:
        model = MemoirDraft
        fields = [
            "id", "user_id", "user_name", "user_email", "user_phone", "user_country",
            "submitted_at", "updated_at", "answers_count",
            "editorial_status", "editorial_notes",
        ]
        read_only_fields = [
            "id", "user_id", "user_name", "user_email", "user_phone", "user_country",
            "submitted_at", "updated_at", "answers_count",
        ]

    @extend_schema_field(OpenApiTypes.INT)
    def get_answers_count(self, obj: MemoirDraft) -> int:
        answers = obj.answers
        if not isinstance(answers, dict):
            return 0
        count = 0
        for a in answers.values():
            if not isinstance(a, dict):
                continue
            structured = a.get("structured", {})
            has_structured = any(
                (isinstance(v, list) and len(v) > 0) or (isinstance(v, str) and v.strip())
                for v in structured.values()
            )
            if (
                a.get("text", "").strip()
                or a.get("audioTranscript", "").strip()
                or a.get("notApplicable")
                or has_structured
                or bool(a.get("imageCaptions"))
            ):
                count += 1
        return count


class AdminMemoirDetailSerializer(AdminMemoirListSerializer):
    """Détail complet d'une soumission (inclut les réponses)."""

    class Meta(AdminMemoirListSerializer.Meta):
        fields = AdminMemoirListSerializer.Meta.fields + ["answers"]
        read_only_fields = AdminMemoirListSerializer.Meta.read_only_fields + ["answers"]

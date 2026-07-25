"""Serializers de la communauté (fil, commentaires, signalements)."""
from rest_framework import serializers

from .models import Audience, Comment, Post, Report
from .services import can_access_audience


class AuthorSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    full_name = serializers.CharField()
    photo = serializers.ImageField()


class PostSerializer(serializers.ModelSerializer):
    author = AuthorSerializer(read_only=True)
    liked_by_me = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = ("id", "author", "text", "image", "video", "audience",
                  "is_pinned", "is_announcement", "likes_count", "liked_by_me",
                  "comments_count", "shared_from", "created_at")
        read_only_fields = ("id", "author", "is_pinned", "is_announcement",
                            "likes_count", "liked_by_me", "comments_count",
                            "shared_from", "created_at")

    def get_liked_by_me(self, obj) -> bool:
        liked = getattr(obj, "liked_by_me_annot", None)
        if liked is not None:
            return bool(liked)
        user = self.context["request"].user
        return obj.likes.filter(user=user).exists()

    def get_comments_count(self, obj) -> int:
        count = getattr(obj, "comments_count_annot", None)
        return count if count is not None else obj.comments.filter(active=True).count()

    def validate(self, attrs):
        if not attrs.get("text") and not attrs.get("image") and not attrs.get("video"):
            raise serializers.ValidationError("Un post doit contenir du texte, une image ou une vidéo.")
        audience = attrs.get("audience", Audience.TOUS)
        if not can_access_audience(self.context["request"].user, audience):
            raise serializers.ValidationError(
                {"audience": "Vous n'avez pas accès à cette audience."})
        return attrs


class CommentSerializer(serializers.ModelSerializer):
    author      = AuthorSerializer(read_only=True)
    likes_count = serializers.SerializerMethodField()
    liked_by_me = serializers.SerializerMethodField()
    # parent est nullable et writable : None pour un commentaire racine, ID pour une réponse
    parent      = serializers.PrimaryKeyRelatedField(
        queryset=Comment.objects.filter(active=True),
        required=False, allow_null=True, default=None,
    )

    class Meta:
        model = Comment
        fields = ("id", "post", "parent", "author", "text", "likes_count", "liked_by_me", "created_at")
        read_only_fields = ("id", "post", "author", "likes_count", "liked_by_me", "created_at")

    def get_likes_count(self, obj) -> int:
        count = getattr(obj, "likes_count_annot", None)
        return count if count is not None else obj.comment_likes.count()

    def get_liked_by_me(self, obj) -> bool:
        liked = getattr(obj, "liked_by_me_annot", None)
        if liked is not None:
            return bool(liked)
        request = self.context.get("request")
        if request is None:
            return False
        return obj.comment_likes.filter(user=request.user).exists()


class ReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = ("id", "target_type", "target_id", "reason", "created_at")
        read_only_fields = ("id", "created_at")

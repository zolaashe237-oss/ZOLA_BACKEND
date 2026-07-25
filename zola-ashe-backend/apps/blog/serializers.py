from rest_framework import serializers

from .models import Article


class ArticleListSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", default="", read_only=True)

    class Meta:
        model = Article
        fields = ("id", "title", "slug", "excerpt", "cover_url", "category",
                  "author_name", "published_at")


class ArticleDetailSerializer(ArticleListSerializer):
    class Meta(ArticleListSerializer.Meta):
        fields = ArticleListSerializer.Meta.fields + ("body",)


class AdminArticleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Article
        fields = ("id", "title", "slug", "excerpt", "body", "cover_url", "category",
                  "published", "published_at", "created_at")
        read_only_fields = ("id", "slug", "published_at", "created_at")

from django.contrib import admin

from .models import Article


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "published", "published_at")
    list_filter = ("published", "category")
    search_fields = ("title", "excerpt")
    prepopulated_fields = {"slug": ("title",)}

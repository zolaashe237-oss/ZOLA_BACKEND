from django.contrib import admin

from .models import Comment, Like, Post, Report


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ("id", "author", "audience", "is_pinned", "is_announcement", "active", "likes_count", "created_at")
    list_filter = ("audience", "is_pinned", "is_announcement", "active")
    search_fields = ("author__email", "text")
    readonly_fields = ("likes_count", "created_at")


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("id", "post", "author", "active", "created_at")
    list_filter = ("active",)
    search_fields = ("author__email", "text")


@admin.register(Like)
class LikeAdmin(admin.ModelAdmin):
    list_display = ("post", "user", "created_at")
    search_fields = ("user__email",)


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ("id", "reporter", "target_type", "target_id", "handled", "created_at")
    list_filter = ("target_type", "handled")
    search_fields = ("reporter__email",)

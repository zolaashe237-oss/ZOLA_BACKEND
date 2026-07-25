from django.contrib import admin

from .models import AIQROAnswer, AIQuestion, AIQuizJob


class AIQuestionInline(admin.TabularInline):
    model = AIQuestion
    extra = 0
    fields = ("order", "kind", "text", "correct_index", "is_published", "edited_by_admin")
    readonly_fields = ("created_at",)


@admin.register(AIQuizJob)
class AIQuizJobAdmin(admin.ModelAdmin):
    list_display = ("id", "module", "status", "source_type", "suggested_level", "created_at", "finished_at")
    list_filter = ("status", "source_type", "suggested_level")
    search_fields = ("id", "module__title", "source_ref")
    readonly_fields = ("id", "created_at", "started_at", "finished_at", "raw_ai_output")
    inlines = [AIQuestionInline]


@admin.register(AIQuestion)
class AIQuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "job", "kind", "order", "is_published", "edited_by_admin", "updated_at")
    list_filter = ("kind", "is_published", "edited_by_admin")
    search_fields = ("text", "job__id")
    readonly_fields = ("created_at", "updated_at")


@admin.register(AIQROAnswer)
class AIQROAnswerAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "question", "verdict", "score", "admin_decision", "submitted_at")
    list_filter = ("verdict", "admin_decision")
    search_fields = ("id", "user__email", "answer_text", "justification")
    readonly_fields = ("submitted_at", "ai_evaluated_at", "admin_decided_at")

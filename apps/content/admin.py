from django.contrib import admin

from .models import Choice, Course, Formation, Module, Question, Quiz, QuizResult, Resource


class ModuleInline(admin.TabularInline):
    model = Module
    extra = 0
    fields = ("title", "parent", "order")
    show_change_link = True


@admin.register(Formation)
class FormationAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "status", "publish_at", "is_reserved", "order", "updated_at")
    list_filter = ("category", "status")
    list_editable = ("status", "order")
    search_fields = ("title", "description")
    inlines = [ModuleInline]
    readonly_fields = ("created_at", "updated_at")


class CourseInline(admin.TabularInline):
    model = Course
    extra = 0
    fields = ("title", "order")
    show_change_link = True


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):
    list_display = ("title", "formation", "parent", "order")
    list_filter = ("formation",)
    search_fields = ("title",)
    inlines = [CourseInline]


class ResourceInline(admin.TabularInline):
    model = Resource
    extra = 0
    fields = ("title", "resource_type", "video_source", "order")
    show_change_link = True


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ("title", "module", "order")
    search_fields = ("title", "description")
    inlines = [ResourceInline]


@admin.register(Resource)
class ResourceAdmin(admin.ModelAdmin):
    list_display = ("title", "course", "resource_type", "video_source", "order")
    list_filter = ("resource_type", "video_source")
    search_fields = ("title", "description")


class ChoiceInline(admin.TabularInline):
    model = Choice
    extra = 4


class QuestionInline(admin.StackedInline):
    model = Question
    extra = 0
    show_change_link = True


@admin.register(Quiz)
class QuizAdmin(admin.ModelAdmin):
    list_display = ("title", "course", "formation", "pass_threshold", "active")
    list_filter = ("active",)
    inlines = [QuestionInline]


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("text", "quiz", "multiple", "order")
    inlines = [ChoiceInline]


@admin.register(QuizResult)
class QuizResultAdmin(admin.ModelAdmin):
    list_display = ("user", "quiz", "score", "attempts", "validated", "validated_at")
    list_filter = ("validated",)
    search_fields = ("user__email", "quiz__title")
    readonly_fields = ("validated_at",)

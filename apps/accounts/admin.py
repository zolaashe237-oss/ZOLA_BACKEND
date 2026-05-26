from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import EmailOTP, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-created_at",)
    list_display = ("email", "full_name", "role", "status", "email_verified", "created_at")
    list_filter = ("role", "status", "email_verified", "is_staff")
    search_fields = ("email", "full_name")
    readonly_fields = ("created_at", "status_changed_at", "last_login")
    filter_horizontal = ("groups", "user_permissions")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profil", {"fields": ("full_name", "photo")}),
        ("Statut & rôle", {"fields": ("role", "status", "status_changed_at", "email_verified", "nb_warnings")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "created_at")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "full_name", "password1", "password2", "role")}),
    )


@admin.register(EmailOTP)
class EmailOTPAdmin(admin.ModelAdmin):
    list_display = ("user", "attempts", "consumed", "expires_at", "created_at")
    list_filter = ("consumed",)
    search_fields = ("user__email",)
    readonly_fields = ("code_hash", "created_at")

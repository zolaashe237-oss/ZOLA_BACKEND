from django.contrib import admin

from .models import Payment, Subscription


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "type", "start", "end", "active", "in_tranches")
    list_filter = ("type", "active", "in_tranches")
    search_fields = ("user__email",)
    readonly_fields = ("created_at",)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("user", "type", "status", "amount", "swinmo_ref", "paid_at")
    list_filter = ("type", "status")
    search_fields = ("user__email", "swinmo_ref")
    readonly_fields = ("paid_at",)

    def has_delete_permission(self, request, obj=None):
        # PAYMENTS est append-only (RG-36) : pas de suppression depuis l'admin.
        return False

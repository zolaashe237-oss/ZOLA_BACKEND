"""Back-office — sessions en direct, canaux et posts communautaires."""
from django.db.models import Q
from rest_framework import serializers as drf_serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.community.models import CommunityChannel, Post, PostStatus
from apps.content.models import LiveSession

from .permissions import IsAdmin
from .serializers import (
    AdminChannelSerializer,
    AdminCommunityPostSerializer,
    AdminLiveSessionSerializer,
)

_TAG_LIVE = "Admin · Lives"
_TAG_COMMUNITY = "Admin · Communauté"
_MAX_PINNED = 3


class _StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


# ─── Sessions en direct (admin) ───────────────────────────────────────────────

class AdminLiveSessionViewSet(viewsets.ModelViewSet):
    """CRUD complet des sessions en direct / replay (admin)."""
    serializer_class = AdminLiveSessionSerializer
    permission_classes = [IsAdmin]
    queryset = LiveSession.objects.all().order_by("-start_at")
    pagination_class = _StandardPagination

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if branche := params.get("branche"):
            qs = qs.filter(branche=branche)
        if live_status := params.get("status"):
            qs = qs.filter(status=live_status)
        if search := params.get("search"):
            qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))
        return qs

    def perform_create(self, serializer):
        session = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="LiveSession",
               target_id=session.id, payload={"created": True})

    def perform_update(self, serializer):
        session = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="LiveSession",
               target_id=session.id)

    def perform_destroy(self, instance):
        record(self.request.user, AuditAction.DELETE_CONTENT, target_type="LiveSession",
               target_id=instance.id)
        instance.delete()


# ─── Canaux communautaires ────────────────────────────────────────────────────

class AdminChannelViewSet(viewsets.ModelViewSet):
    """CRUD des canaux/espaces communautaires (admin)."""
    serializer_class = AdminChannelSerializer
    permission_classes = [IsAdmin]
    queryset = CommunityChannel.objects.all()
    pagination_class = _StandardPagination

    def get_queryset(self):
        qs = super().get_queryset()
        if branche := self.request.query_params.get("branche"):
            qs = qs.filter(branche=branche)
        return qs

    def perform_create(self, serializer):
        channel = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="CommunityChannel",
               target_id=channel.id, payload={"created": True})

    def perform_update(self, serializer):
        channel = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="CommunityChannel",
               target_id=channel.id)

    def perform_destroy(self, instance):
        record(self.request.user, AuditAction.DELETE_CONTENT, target_type="CommunityChannel",
               target_id=instance.id)
        instance.delete()


# ─── Posts communautaires (admin) ────────────────────────────────────────────

class AdminCommunityPostViewSet(viewsets.ModelViewSet):
    """CRUD + pin + moderate des posts communautaires (admin)."""
    serializer_class = AdminCommunityPostSerializer
    permission_classes = [IsAdmin]
    queryset = Post.objects.select_related("author", "channel").order_by("-is_pinned", "-created_at")
    pagination_class = _StandardPagination

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if channel := params.get("channel"):
            qs = qs.filter(channel_id=channel)
        if post_type := params.get("type"):
            qs = qs.filter(type=post_type)
        if post_status := params.get("status"):
            qs = qs.filter(post_status=post_status)
        if search := params.get("search"):
            qs = qs.filter(
                Q(title__icontains=search) | Q(text__icontains=search)
                | Q(author__full_name__icontains=search)
            )
        return qs

    def perform_create(self, serializer):
        post = serializer.save(author=self.request.user, is_announcement=True)
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="Post",
               target_id=post.id, payload={"created": True})

    def perform_update(self, serializer):
        post = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="Post",
               target_id=post.id)

    def perform_destroy(self, instance):
        instance.active = False
        instance.post_status = PostStatus.ARCHIVE
        instance.save(update_fields=["active", "post_status"])
        record(self.request.user, AuditAction.DELETE_CONTENT, target_type="Post",
               target_id=instance.id)

    @action(detail=True, methods=["post"])
    def pin(self, request, pk=None):
        """Épingle/désépingle un post (max 3 épinglés simultanément — CDC §4.2)."""
        post = self.get_object()
        if not post.is_pinned:
            pinned_count = Post.objects.filter(is_pinned=True, active=True).count()
            if pinned_count >= _MAX_PINNED:
                return Response(
                    {"detail": f"Maximum {_MAX_PINNED} posts épinglés simultanément."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        post.is_pinned = not post.is_pinned
        post.save(update_fields=["is_pinned"])
        record(request.user, AuditAction.UPDATE_CONTENT, target_type="Post",
               target_id=post.id, payload={"pinned": post.is_pinned})
        return Response({"is_pinned": post.is_pinned})

    @action(detail=True, methods=["post"])
    def moderate(self, request, pk=None):
        """Modère un post (masquage + journalisation du motif)."""
        reason = request.data.get("reason", "")
        if not reason:
            return Response({"detail": "Un motif est requis."}, status=status.HTTP_400_BAD_REQUEST)
        post = self.get_object()
        post.post_status = PostStatus.MODERE
        post.active = False
        post.save(update_fields=["post_status", "active"])
        record(request.user, AuditAction.DELETE_CONTENT, target_type="Post",
               target_id=post.id, reason=reason)
        return Response({"status": "MODERE"})


# ─── Notifications système (broadcast) ───────────────────────────────────────

class AdminBroadcastNotifView(APIView):
    """POST /api/admin/notifications/broadcast/ — envoie une notif SYSTEME aux membres actifs."""
    permission_classes = [IsAdmin]

    def post(self, request):
        from apps.notifications.models import Notification, NotifType
        from apps.accounts.models import User, Role, UserStatus

        title   = (request.data.get("title") or "").strip()
        body    = (request.data.get("body")  or "").strip()
        user_id = request.data.get("user_id")

        if not title:
            return Response({"detail": "Le titre est requis."}, status=400)

        qs = User.objects.filter(role=Role.MEMBER, status=UserStatus.ACTIF)
        if user_id:
            qs = qs.filter(pk=user_id)

        notifs = [
            Notification(user=u, type=NotifType.SYSTEME, title=title, body=body)
            for u in qs
        ]
        Notification.objects.bulk_create(notifs)

        record(request.user, AuditAction.SEND_NOTIFICATION,
               reason=title,
               payload={"sent": len(notifs), "user_id": user_id})
        return Response({"sent": len(notifs)})

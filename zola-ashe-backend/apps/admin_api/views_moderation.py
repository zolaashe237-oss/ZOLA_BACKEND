"""Back-office — modération du fil et consultation de l'audit (CDC §5.5, §7.6)."""
from django.db.models import Count
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import generics, serializers as drf_serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction, AuditLog
from apps.audit.serializers import AuditLogSerializer
from apps.audit.services import record
from apps.community.models import Comment, Like, Post, Report
from apps.community.tasks import send_moderation_notification

from .permissions import AdminModerationThrottle, IsAdmin

_TAG = "Admin · Modération & Audit"
_ReasonRequest = inline_serializer(name="ModerationReasonRequest",
                                   fields={"reason": drf_serializers.CharField(required=False)})
_DetailResponse = inline_serializer(name="ModerationDetail",
                                    fields={"detail": drf_serializers.CharField()})
_ReportList = inline_serializer(
    name="ReportQueueList", many=True,
    fields={"id": drf_serializers.IntegerField(), "target_type": drf_serializers.CharField(),
            "target_id": drf_serializers.IntegerField(), "reason": drf_serializers.CharField(),
            "reporter": drf_serializers.CharField(), "signal_count": drf_serializers.IntegerField(),
            "created_at": drf_serializers.DateTimeField()})


@extend_schema(tags=[_TAG], summary="File de modération",
               description="Signalements non traités, priorisés par nombre de signalements sur la même cible.",
               responses={200: _ReportList})
class ReportQueueView(APIView):
    """File de modération priorisée (CDC §5.5)."""
    permission_classes = [IsAdmin]

    def get(self, _request):
        # Compte de signalements par cible (priorisation).
        counts = {
            (r["target_type"], r["target_id"]): r["n"]
            for r in Report.objects.filter(handled=False)
            .values("target_type", "target_id").annotate(n=Count("id"))
        }
        items = []
        for report in Report.objects.filter(handled=False).select_related("reporter").order_by("-created_at"):
            items.append({
                "id": report.id,
                "target_type": report.target_type,
                "target_id": report.target_id,
                "reason": report.reason,
                "reporter": report.reporter.email,
                "signal_count": counts.get((report.target_type, report.target_id), 1),
                "created_at": report.created_at,
            })
        return Response(items)


@extend_schema(tags=[_TAG], summary="Traiter un signalement",
               description="Marque un signalement comme traité (sans suppression de contenu). "
                           "Le motif/décision du modérateur est journalisé à l'audit (RG-31).",
               request=_ReasonRequest, responses={200: _DetailResponse})
class HandleReportView(APIView):
    permission_classes = [IsAdmin]
    throttle_classes   = [AdminModerationThrottle]

    def post(self, request, pk=None):
        report = Report.objects.filter(id=pk).first()
        if report is None:
            return Response({"detail": "Signalement introuvable."}, status=status.HTTP_404_NOT_FOUND)
        report.handled = True
        report.save(update_fields=["handled"])
        record(request.user, AuditAction.RESOLVE_REPORT, target_type="Report", target_id=report.id,
               reason=request.data.get("reason", ""),
               payload={"target_type": report.target_type, "target_id": report.target_id})
        return Response({"detail": "Signalement traité."})


@extend_schema(tags=[_TAG], summary="Supprimer une publication (modération)",
               description="Suppression logique d'un post + ses commentaires/likes (RG-33). Motif journalisé.",
               request=_ReasonRequest, responses={200: _DetailResponse})
class AdminDeletePostView(APIView):
    """Suppression d'un post par modération (RG-33) — cascade logique."""
    permission_classes = [IsAdmin]
    throttle_classes   = [AdminModerationThrottle]

    def post(self, request, pk=None):
        post = Post.objects.select_related("author").filter(id=pk).first()
        if post is None:
            return Response({"detail": "Publication introuvable."}, status=status.HTTP_404_NOT_FOUND)
        reason = request.data.get("reason", "")
        post.active = False
        post.likes_count = 0
        post.save(update_fields=["active", "likes_count"])
        Comment.objects.filter(post=post).update(active=False)
        Like.objects.filter(post=post).delete()
        record(request.user, AuditAction.DELETE_POST, target_type="Post", target_id=post.id, reason=reason)
        send_moderation_notification.delay(post.author.email, "post", reason)
        return Response({"detail": "Publication supprimée."})


@extend_schema(tags=[_TAG], summary="Supprimer un commentaire (modération)",
               description="Suppression logique d'un commentaire. Motif journalisé.",
               request=_ReasonRequest, responses={200: _DetailResponse})
class AdminDeleteCommentView(APIView):
    permission_classes = [IsAdmin]
    throttle_classes   = [AdminModerationThrottle]

    def post(self, request, pk=None):
        comment = Comment.objects.select_related("author").filter(id=pk).first()
        if comment is None:
            return Response({"detail": "Commentaire introuvable."}, status=status.HTTP_404_NOT_FOUND)
        reason = request.data.get("reason", "")
        comment.active = False
        comment.save(update_fields=["active"])
        record(request.user, AuditAction.DELETE_COMMENT, target_type="Comment",
               target_id=comment.id, reason=reason)
        send_moderation_notification.delay(comment.author.email, "commentaire", reason)
        return Response({"detail": "Commentaire supprimé."})


@extend_schema(tags=[_TAG], summary="Journal d'audit",
               description="Consultation en lecture seule du journal d'audit (append-only), "
                           "filtrable par `?action=`, `?actor=`, `?date_from=` et `?date_to=`.",
               parameters=[
                   OpenApiParameter("action", str),
                   OpenApiParameter("actor", int),
                   OpenApiParameter("date_from", str, description="YYYY-MM-DD"),
                   OpenApiParameter("date_to", str, description="YYYY-MM-DD (inclus)"),
               ])
class AuditLogListView(generics.ListAPIView):
    """Consultation du journal d'audit (lecture seule, filtrable)."""
    permission_classes = [IsAdmin]
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor").all()
        params = self.request.query_params
        if action := params.get("action"):
            qs = qs.filter(action=action)
        if actor := params.get("actor"):
            qs = qs.filter(actor_id=actor)
        if date_from := params.get("date_from"):
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to := params.get("date_to"):
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

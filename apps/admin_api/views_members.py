"""Back-office — gestion des membres (CDC §5.3). Chaque action est journalisée."""
from uuid import uuid4

from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view, inline_serializer
from rest_framework import mixins, serializers as drf_serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.accounts.models import Role, User, UserStatus
from apps.accounts.services import generate_otp
from apps.accounts.tasks import send_otp_email
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.billing.services import is_member

from .permissions import IsAdmin
from .serializers import (
    MemberDetailSerializer,
    MemberListSerializer,
    ReasonSerializer,
)

_StatusResponse = inline_serializer(name="MemberStatusResponse",
                                    fields={"status": drf_serializers.CharField()})
_WarnResponse = inline_serializer(
    name="WarnResponse",
    fields={"nb_warnings": drf_serializers.IntegerField(), "recidive_alert": drf_serializers.BooleanField()})


def _revoke_tokens(user):
    """Blackliste tous les refresh tokens du membre (révocation de session)."""
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


@extend_schema_view(
    list=extend_schema(tags=["Admin · Membres"], summary="Lister les membres",
                       description="Membres filtrables par `?status=` (ACTIF/RESTREINT/BLOQUE) et `?search=`.",
                       parameters=[OpenApiParameter("status", str), OpenApiParameter("search", str)]),
    retrieve=extend_schema(tags=["Admin · Membres"], summary="Fiche membre",
                           description="Détail complet : abonnements, paiements, résultats de QCM."),
    destroy=extend_schema(tags=["Admin · Membres"], summary="Anonymiser un membre (RGPD)",
                          description="Purge RGPD par anonymisation (les paiements protégés interdisent la suppression dure)."),
)
class MemberViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                    mixins.DestroyModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAdmin]

    def get_serializer_class(self):
        return MemberDetailSerializer if self.action == "retrieve" else MemberListSerializer

    def get_queryset(self):
        qs = User.objects.filter(role=Role.MEMBER).order_by("-created_at")
        params = self.request.query_params
        if statut := params.get("status"):
            qs = qs.filter(status=statut)
        if search := params.get("search"):
            qs = qs.filter(full_name__icontains=search) | qs.filter(email__icontains=search)
        return qs

    # — Actions —

    @extend_schema(tags=["Admin · Membres"], summary="Bloquer un membre",
                   description="Passe le membre en BLOQUE et révoque ses sessions. Motif journalisé.",
                   request=ReasonSerializer, responses={200: _StatusResponse})
    @action(detail=True, methods=["post"])
    def block(self, request, pk=None):
        user = self.get_object()
        reason = request.data.get("reason", "")
        user.set_status(UserStatus.BLOQUE)
        _revoke_tokens(user)
        record(request.user, AuditAction.BLOCK_USER, target_type="User", target_id=user.id, reason=reason)
        return Response({"status": user.status})

    @extend_schema(tags=["Admin · Membres"], summary="Débloquer un membre",
                   description="Repasse le membre en ACTIF (si adhérent) ou RESTREINT.",
                   request=None, responses={200: _StatusResponse})
    @action(detail=True, methods=["post"])
    def unblock(self, request, pk=None):
        user = self.get_object()
        # Adhérent → ACTIF (cotisation recalculée au prochain cron) ; sinon RESTREINT.
        user.set_status(UserStatus.ACTIF if is_member(user) else UserStatus.RESTREINT)
        record(request.user, AuditAction.UNBLOCK_USER, target_type="User", target_id=user.id)
        return Response({"status": user.status})

    @extend_schema(tags=["Admin · Membres"], summary="Avertir un membre",
                   description="Incrémente le compteur d'avertissements ; alerte récidive dès 3 (RG-32). Motif requis.",
                   request=ReasonSerializer, responses={200: _WarnResponse})
    @action(detail=True, methods=["post"])
    def warn(self, request, pk=None):
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = self.get_object()
        user.nb_warnings += 1
        user.save(update_fields=["nb_warnings"])
        record(request.user, AuditAction.WARN_USER, target_type="User", target_id=user.id,
               reason=serializer.validated_data["reason"])
        return Response({"nb_warnings": user.nb_warnings,
                         "recidive_alert": user.nb_warnings >= 3})  # RG-32

    @extend_schema(tags=["Admin · Membres"], summary="Envoyer une réinitialisation de mot de passe",
                   description="Génère et envoie un OTP de réinitialisation au membre.", request=None)
    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        user = self.get_object()
        code = generate_otp(user)
        send_otp_email.delay(user.email, code, "reset")
        return Response({"detail": "Email de réinitialisation envoyé."})

    def destroy(self, request, *args, **kwargs):
        """Purge RGPD : anonymisation (les paiements protégés interdisent la suppression dure)."""
        user = self.get_object()
        old_id = user.id
        user.full_name = "Compte supprimé"
        user.email = f"deleted+{uuid4().hex[:12]}@zola-ashe.invalid"
        user.photo = None
        user.is_active = False
        user.set_status(UserStatus.BLOQUE)
        user.save(update_fields=["full_name", "email", "photo", "is_active"])
        _revoke_tokens(user)
        record(request.user, AuditAction.EXPORT_DATA, target_type="User", target_id=old_id,
               reason="Purge RGPD (anonymisation)")
        return Response(status=status.HTTP_204_NO_CONTENT)

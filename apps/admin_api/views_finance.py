"""Back-office — finance, dashboard, exports (CDC §5.2, §5.7 ; RG-06/39/40/41)."""
import csv
from datetime import timedelta

from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers as drf_serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role, User, UserStatus
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.billing.models import Payment, PaymentStatus, PaymentType
from apps.billing.services import activate_paid_payment, resolve_plan
from apps.community.models import Report
from apps.content.models import QuizResult

from .permissions import IsAdmin
from .serializers import ExonerationSerializer, ManualPaymentSerializer, RefundSerializer

_TAG = "Admin · Finance"
_PaymentCreatedResponse = inline_serializer(
    name="PaymentCreatedResponse",
    fields={"payment_id": drf_serializers.IntegerField(), "status": drf_serializers.CharField(required=False)})
_DashboardResponse = inline_serializer(
    name="DashboardKPIs",
    fields={k: drf_serializers.IntegerField() for k in (
        "members_active", "members_restricted", "revenue_month", "cotisations_late",
        "reports_pending", "new_members_month", "modules_validated_month")})


def _month_start():
    return timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


@extend_schema(tags=[_TAG], summary="Tableau de bord (KPIs)",
               description="Indicateurs temps réel : membres actifs/restreints, revenus du mois, "
                           "cotisations en retard, signalements en attente, nouveaux membres, modules validés.",
               responses={200: _DashboardResponse})
class DashboardView(APIView):
    """KPIs temps réel du back-office (CDC §5.2)."""
    permission_classes = [IsAdmin]

    def get(self, _request):
        month_start = _month_start()
        late_threshold = timezone.now() - timedelta(days=30)

        revenue = (
            Payment.objects.filter(status=PaymentStatus.VALIDE, paid_at__gte=month_start)
            .aggregate(total=Sum("amount"))["total"] or 0
        )
        # Membres en retard : dernier paiement COTISATION VALIDE > 30 jours.
        late = 0
        for user in User.objects.filter(role=Role.MEMBER, status=UserStatus.ACTIF):
            last = (Payment.objects.filter(user=user, type=PaymentType.COTISATION,
                                           status=PaymentStatus.VALIDE)
                    .order_by("-paid_at").first())
            if last is None or last.paid_at < late_threshold:
                late += 1

        return Response({
            "members_active": User.objects.filter(status=UserStatus.ACTIF).count(),
            "members_restricted": User.objects.filter(status=UserStatus.RESTREINT).count(),
            "revenue_month": revenue,
            "cotisations_late": late,
            "reports_pending": Report.objects.filter(handled=False).count(),
            "new_members_month": User.objects.filter(role=Role.MEMBER, created_at__gte=month_start).count(),
            "modules_validated_month": QuizResult.objects.filter(
                validated=True, validated_at__gte=month_start).count(),
        })


@extend_schema(tags=[_TAG], summary="Paiement manuel (hors Swinmo)",
               description="Enregistre et valide un paiement saisi par l'admin (espèces, virement…), "
                           "et active l'adhésion/cotisation correspondante (RG-06). `swinmo_ref` reste nul.",
               request=ManualPaymentSerializer, responses={201: _PaymentCreatedResponse})
class ManualPaymentView(APIView):
    """Validation manuelle d'un paiement hors Swinmo (RG-06)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        serializer = ManualPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = User.objects.filter(id=data["user_id"]).first()
        if user is None:
            return Response({"detail": "Membre introuvable."}, status=status.HTTP_404_NOT_FOUND)

        plan = resolve_plan(data["kind"])
        amount = data.get("amount") if data.get("amount") is not None else plan.amount
        # swinmo_ref = NULL (RG-06) ; on réutilise la logique d'activation métier.
        payment = Payment.objects.create(
            user=user, type=plan.payment_type, status=PaymentStatus.EN_ATTENTE,
            amount=amount, swinmo_ref=None, reason=data["reason"])
        activate_paid_payment(payment, data["kind"])
        record(request.user, AuditAction.MANUAL_PAYMENT, target_type="Payment", target_id=payment.id,
               reason=data["reason"], payload={"kind": data["kind"], "amount": amount})
        return Response({"payment_id": payment.id, "status": payment.status},
                        status=status.HTTP_201_CREATED)


@extend_schema(tags=[_TAG], summary="Rembourser (trace comptable)",
               description="Crée une écriture de remboursement (RG-39) : montant stocké négatif, append-only.",
               request=RefundSerializer, responses={201: _PaymentCreatedResponse})
class RefundView(APIView):
    """Trace comptable d'un remboursement (RG-39) — montant négatif, append-only."""
    permission_classes = [IsAdmin]

    def post(self, request):
        serializer = RefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = User.objects.filter(id=data["user_id"]).first()
        if user is None:
            return Response({"detail": "Membre introuvable."}, status=status.HTTP_404_NOT_FOUND)
        payment = Payment.objects.create(
            user=user, type=PaymentType.REMBOURSEMENT, status=PaymentStatus.VALIDE,
            amount=-abs(data["amount"]), swinmo_ref=None, reason=data["reason"])
        record(request.user, AuditAction.MANUAL_PAYMENT, target_type="Payment", target_id=payment.id,
               reason=data["reason"], payload={"refund": True, "amount": -abs(data["amount"])})
        return Response({"payment_id": payment.id}, status=status.HTTP_201_CREATED)


@extend_schema(tags=[_TAG], summary="Exonérer de cotisation",
               description="Crée une cotisation VALIDE à montant 0 (RG-40), pour les cas sociaux.",
               request=ExonerationSerializer, responses={201: _PaymentCreatedResponse})
class ExonerationView(APIView):
    """Exonération de cotisation (RG-40) — paiement VALIDE montant 0."""
    permission_classes = [IsAdmin]

    def post(self, request):
        serializer = ExonerationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = User.objects.filter(id=data["user_id"]).first()
        if user is None:
            return Response({"detail": "Membre introuvable."}, status=status.HTTP_404_NOT_FOUND)
        payment = Payment.objects.create(
            user=user, type=PaymentType.COTISATION, status=PaymentStatus.VALIDE,
            amount=0, swinmo_ref=None, reason="Exonération admin : " + data["reason"])
        record(request.user, AuditAction.MANUAL_PAYMENT, target_type="Payment", target_id=payment.id,
               reason=data["reason"], payload={"exoneration": True})
        return Response({"payment_id": payment.id}, status=status.HTTP_201_CREATED)


@extend_schema(tags=[_TAG], summary="Exporter les membres (CSV)",
               description="Télécharge la liste des membres au format CSV. Action journalisée.",
               responses={200: OpenApiResponse(OpenApiTypes.BINARY, description="Fichier CSV.")})
class ExportMembersView(APIView):
    """Export CSV de la liste des membres (CDC §5.3) — journalisé."""
    permission_classes = [IsAdmin]

    def get(self, request):
        record(request.user, AuditAction.EXPORT_DATA, target_type="User", reason="Export membres CSV")
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="membres.csv"'
        writer = csv.writer(response)
        writer.writerow(["id", "email", "nom", "statut", "verifie", "avertissements", "inscrit_le"])
        for u in User.objects.filter(role=Role.MEMBER).order_by("id"):
            writer.writerow([u.id, u.email, u.full_name, u.status, u.email_verified,
                             u.nb_warnings, u.created_at.date()])
        return response


@extend_schema(tags=[_TAG], summary="Exporter les paiements (CSV)",
               description="Télécharge l'ensemble des paiements au format CSV. Action journalisée.",
               responses={200: OpenApiResponse(OpenApiTypes.BINARY, description="Fichier CSV.")})
class ExportPaymentsView(APIView):
    """Export CSV des paiements (CDC §5.7) — journalisé."""
    permission_classes = [IsAdmin]

    def get(self, request):
        record(request.user, AuditAction.EXPORT_DATA, target_type="Payment", reason="Export paiements CSV")
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="paiements.csv"'
        writer = csv.writer(response)
        writer.writerow(["id", "membre", "type", "statut", "montant", "swinmo_ref", "date"])
        for p in Payment.objects.select_related("user").order_by("id"):
            writer.writerow([p.id, p.user.email, p.type, p.status, p.amount,
                             p.swinmo_ref or "", p.paid_at])
        return response


@extend_schema(tags=[_TAG], summary="Relancer les cotisations en retard",
               description="Envoie un email de relance à chaque membre ACTIF dont la dernière cotisation "
                           "validée date de plus de 30 jours. Renvoie le nombre de relances.",
               request=None,
               responses={200: inline_serializer(name="RemindersResponse",
                                                  fields={"reminded": drf_serializers.IntegerField()})})
class SendRemindersView(APIView):
    """Relance email groupée des membres en retard de cotisation (CDC §5.7)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        from apps.billing.tasks import send_payment_reminder
        late_threshold = timezone.now() - timedelta(days=30)
        targets = []
        for user in User.objects.filter(role=Role.MEMBER, status=UserStatus.ACTIF):
            last = (Payment.objects.filter(user=user, type=PaymentType.COTISATION,
                                           status=PaymentStatus.VALIDE)
                    .order_by("-paid_at").first())
            if last is None or last.paid_at < late_threshold:
                send_payment_reminder.delay(user.id)
                targets.append(user.id)
        record(request.user, AuditAction.SEND_REMINDER, reason="Relance groupée cotisations",
               payload={"count": len(targets)})
        return Response({"reminded": len(targets)})

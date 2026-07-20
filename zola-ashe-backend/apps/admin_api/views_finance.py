"""Back-office — finance, dashboard, exports (CDC §5.2, §5.7 ; RG-06/39/40/41)."""
import csv
from datetime import timedelta

from django.db.models import Sum, Q
from django.http import HttpResponse, StreamingHttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers as drf_serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination

from apps.accounts.models import Role, User, UserStatus
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.billing.models import Payment, PaymentStatus, PaymentType, SubscriptionPlan
from apps.billing.services import activate_paid_payment, resolve_plan
from apps.community.models import Report
from apps.content.models import QuizResult

from .permissions import IsAdmin
from .serializers import (
    AdminSubscriptionPlanSerializer,
    ExonerationSerializer,
    ManualPaymentSerializer,
    RefundSerializer,
    MemberListSerializer,
    TransactionSerializer,
)

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


class _Echo:
    """Pseudo-buffer pour csv.writer : retourne chaque ligne plutôt que la stocker."""
    def write(self, value):
        return value


@extend_schema(tags=[_TAG], summary="Exporter les membres (CSV)",
               description="Télécharge la liste des membres au format CSV (streaming). Action journalisée.",
               responses={200: OpenApiResponse(OpenApiTypes.BINARY, description="Fichier CSV.")})
class ExportMembersView(APIView):
    """Export CSV streamé des membres (CDC §5.3) — aucune mise en mémoire complète."""
    permission_classes = [IsAdmin]

    def get(self, request):
        record(request.user, AuditAction.EXPORT_DATA, target_type="User", reason="Export membres CSV")

        qs = User.objects.filter(role=Role.MEMBER).order_by("id")
        date_from = request.query_params.get("date_from")
        date_to   = request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        writer = csv.writer(_Echo())

        def generate():
            yield writer.writerow(["id", "email", "nom", "statut", "verifie",
                                   "avertissements", "inscrit_le"])
            for u in qs.iterator(chunk_size=500):
                yield writer.writerow([u.id, u.email, u.full_name, u.status,
                                       u.email_verified, u.nb_warnings, u.created_at.date()])

        response = StreamingHttpResponse(generate(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="membres.csv"'
        return response


@extend_schema(tags=[_TAG], summary="Exporter les paiements (CSV)",
               description="Télécharge l'ensemble des paiements au format CSV (streaming). Action journalisée.",
               responses={200: OpenApiResponse(OpenApiTypes.BINARY, description="Fichier CSV.")})
class ExportPaymentsView(APIView):
    """Export CSV streamé des paiements (CDC §5.7) — aucune mise en mémoire complète."""
    permission_classes = [IsAdmin]

    def get(self, request):
        record(request.user, AuditAction.EXPORT_DATA, target_type="Payment", reason="Export paiements CSV")

        qs = Payment.objects.select_related("user").order_by("id")
        date_from = request.query_params.get("date_from")
        date_to   = request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(paid_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(paid_at__date__lte=date_to)

        writer = csv.writer(_Echo())

        def generate():
            yield writer.writerow(["id", "membre", "type", "statut", "montant",
                                   "swinmo_ref", "date"])
            for p in qs.iterator(chunk_size=500):
                email = p.user.email if p.user else "Compte anonymisé"
                yield writer.writerow([p.id, email, p.type, p.status, p.amount,
                                       p.swinmo_ref or "", p.paid_at])

        response = StreamingHttpResponse(generate(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="paiements.csv"'
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
        user_id = request.data.get("user_id")
        late_threshold = timezone.now() - timedelta(days=30)
        targets = []

        qs = User.objects.filter(role=Role.MEMBER, status=UserStatus.ACTIF)
        if user_id:
            qs = qs.filter(pk=user_id)

        for user in qs:
            last = (Payment.objects.filter(user=user, type=PaymentType.COTISATION,
                                           status=PaymentStatus.VALIDE)
                    .order_by("-paid_at").first())
            if last is None or last.paid_at < late_threshold:
                send_payment_reminder.delay(user.id)
                targets.append(user.id)

        record(request.user, AuditAction.SEND_REMINDER,
               reason="Relance individuelle" if user_id else "Relance groupée cotisations",
               payload={"count": len(targets), "user_id": user_id})
        return Response({"reminded": len(targets)})


class MonthlyRevenueView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        now = timezone.now()
        current_year = now.year
        current_month = now.month
        months_fr = [
            "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
            "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
        ]
        results = []
        for i in range(12):
            y = current_year
            m = current_month - i
            while m <= 0:
                m += 12
                y -= 1
            
            start_date = timezone.datetime(y, m, 1, 0, 0, 0, tzinfo=timezone.get_current_timezone())
            if m == 12:
                end_date = timezone.datetime(y + 1, 1, 1, 0, 0, 0, tzinfo=timezone.get_current_timezone())
            else:
                end_date = timezone.datetime(y, m + 1, 1, 0, 0, 0, tzinfo=timezone.get_current_timezone())
            
            total_amount = Payment.objects.filter(
                status=PaymentStatus.VALIDE,
                paid_at__gte=start_date,
                paid_at__lt=end_date
            ).aggregate(total=Sum("amount"))["total"] or 0
            
            results.append({
                "label": f"{months_fr[m]} {y}",
                "amount": total_amount
            })
            
        return Response(list(reversed(results)))


class PaymentBreakdownView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        start = _month_start()
        qs = Payment.objects.filter(status=PaymentStatus.VALIDE, paid_at__gte=start)
        
        inscription = qs.filter(type=PaymentType.INSCRIPTION).aggregate(total=Sum("amount"))["total"] or 0
        cotisation = qs.filter(type=PaymentType.COTISATION).aggregate(total=Sum("amount"))["total"] or 0
        don = qs.filter(type=PaymentType.DON).aggregate(total=Sum("amount"))["total"] or 0
        remboursement = abs(qs.filter(type=PaymentType.REMBOURSEMENT).aggregate(total=Sum("amount"))["total"] or 0)
        
        return Response({
            "INSCRIPTION": inscription,
            "COTISATION": cotisation,
            "DON": don,
            "REMBOURSEMENT": remboursement,
            "inscription": inscription,
            "cotisation": cotisation,
            "don": don,
            "remboursement": remboursement
        })


class LateCotisationsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        from django.conf import settings
        now = timezone.now()
        late_threshold = now - timedelta(days=30)

        # Prix d'une cotisation mensuelle (fallback settings si pas de plan actif)
        try:
            plan = SubscriptionPlan.objects.get(kind="COTISATION", is_active=True)
            unit_price = plan.tranche_amount or plan.price_total
        except SubscriptionPlan.DoesNotExist:
            unit_price = getattr(settings, "PRICE_COTISATION", 10000)

        results = []
        for user in User.objects.filter(role=Role.MEMBER, status=UserStatus.ACTIF):
            last = (
                Payment.objects
                .filter(user=user, type=PaymentType.COTISATION, status=PaymentStatus.VALIDE)
                .order_by("-paid_at")
                .first()
            )
            if last is None or last.paid_at < late_threshold:
                if last is None:
                    # Jamais payé — retard depuis la date d'inscription
                    delta_days = (now - user.created_at).days
                else:
                    delta_days = (now - last.paid_at).days

                months_late = max(1, delta_days // 30)
                amount_due  = months_late * unit_price

                data = MemberListSerializer(user).data
                data["months_late"] = months_late
                data["amount_due"]  = amount_due
                results.append(data)

        return Response(results)


class TransactionKpisView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        month_start = _month_start()
        
        revenue_total = Payment.objects.filter(status=PaymentStatus.VALIDE).aggregate(total=Sum("amount"))["total"] or 0
        revenue_month = Payment.objects.filter(status=PaymentStatus.VALIDE, paid_at__gte=month_start).aggregate(total=Sum("amount"))["total"] or 0
        
        count_pending = Payment.objects.filter(status=PaymentStatus.EN_ATTENTE).count()
        count_refunded = Payment.objects.filter(status=PaymentStatus.VALIDE, type=PaymentType.REMBOURSEMENT).count()
        count_failed = Payment.objects.filter(status=PaymentStatus.ECHOUE).count()
        count_total = Payment.objects.count()
        
        return Response({
            "revenue_total": revenue_total,
            "revenue_month": revenue_month,
            "count_pending": count_pending,
            "count_refunded": count_refunded,
            "count_failed": count_failed,
            "count_total": count_total
        })


class TransactionPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class TransactionListView(APIView):
    permission_classes = [IsAdmin]
    pagination_class = TransactionPagination

    def get(self, request):
        params = request.query_params
        qs = Payment.objects.select_related("user").order_by("-paid_at")
        
        # Apply filters
        status_param = params.get("status")
        if status_param:
            if status_param == "REUSSI":
                qs = qs.filter(status=PaymentStatus.VALIDE).exclude(type=PaymentType.REMBOURSEMENT).exclude(type=PaymentType.COTISATION, amount=0)
            elif status_param == "REMBOURSE":
                qs = qs.filter(status=PaymentStatus.VALIDE, type=PaymentType.REMBOURSEMENT)
            elif status_param == "EXONERE":
                qs = qs.filter(status=PaymentStatus.VALIDE, type=PaymentType.COTISATION, amount=0)
            elif status_param == "VALIDE":
                qs = qs.filter(status=PaymentStatus.VALIDE)
            elif status_param in [PaymentStatus.EN_ATTENTE, PaymentStatus.ECHOUE]:
                qs = qs.filter(status=status_param)
            else:
                qs = qs.filter(status=status_param)
                
        kind_param = params.get("kind")
        if kind_param:
            qs = qs.filter(type=kind_param)
            
        method_param = params.get("method")
        if method_param:
            if method_param == "MANUEL":
                qs = qs.filter(swinmo_ref__isnull=True)
            elif method_param == "MTN_MOBILE_MONEY":
                qs = qs.filter(swinmo_ref__isnull=False)
                
        date_from = params.get("date_from")
        if date_from:
            qs = qs.filter(paid_at__date__gte=date_from)
            
        date_to = params.get("date_to")
        if date_to:
            qs = qs.filter(paid_at__date__lte=date_to)
            
        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(user__email__icontains=search) |
                Q(user__full_name__icontains=search) |
                Q(swinmo_ref__icontains=search) |
                Q(reason__icontains=search)
            )
            
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        if page is not None:
            serializer = TransactionSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
            
        serializer = TransactionSerializer(qs, many=True)
        return Response(serializer.data)


# ─── Plans d'abonnement ───────────────────────────────────────────────────────

class AdminSubscriptionPlanViewSet(viewsets.ModelViewSet):
    """CRUD + activation/désactivation des plans tarifaires (admin)."""
    serializer_class = AdminSubscriptionPlanSerializer
    permission_classes = [IsAdmin]
    queryset = SubscriptionPlan.objects.all().order_by("billing", "name")

    @action(detail=True, methods=["post"])
    def toggle(self, request, pk=None):
        """Bascule l'état actif/inactif d'un plan tarifaire."""
        plan = self.get_object()
        plan.is_active = not plan.is_active
        plan.save(update_fields=["is_active"])
        return Response(AdminSubscriptionPlanSerializer(plan).data)


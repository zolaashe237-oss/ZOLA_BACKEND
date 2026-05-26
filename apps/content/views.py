"""Vues membre du contenu : catalogue de formations, arbre modules→cours,
streaming signé des ressources et passage des QCM (RG-16 à RG-28)."""
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import serializers as drf_serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Formation, Quiz, QuizResult, Resource
from .serializers import (
    FormationDetailSerializer,
    FormationListSerializer,
    QuizPublicSerializer,
    QuizResultSerializer,
    QuizSubmitSerializer,
)
from .services import (
    course_unlocked,
    final_exam_unlocked,
    formation_accessible,
    generate_signed_url,
    grade_quiz,
    record_quiz_result,
    visible_formations_qs,
)


def _accessible_sub_types(user) -> set[str]:
    """Types d'abonnement ouvrant un accès au membre (calculé une fois par requête)."""
    from apps.billing.models import SubscriptionType
    from apps.billing.services import has_subscription_access
    return {t for t in SubscriptionType.values if has_subscription_access(user, t)}


def _quiz_access(user, quiz: Quiz) -> dict:
    """État d'accès d'un QCM : {locked, lock_reason} selon abonnement + progression."""
    formation = quiz.formation if quiz.is_final else quiz.course.module.formation
    if not formation_accessible(user, formation):
        return {"locked": True, "lock_reason": "subscription"}
    unlocked = (final_exam_unlocked(user, formation) if quiz.is_final
                else course_unlocked(user, quiz.course))
    if not unlocked:
        return {"locked": True, "lock_reason": "quiz"}
    return {"locked": False, "lock_reason": None}


_StreamResponse = inline_serializer(
    name="ResourceStreamResponse",
    fields={"kind": drf_serializers.ChoiceField(choices=["youtube", "file"]),
            "url": drf_serializers.CharField(help_text="Lien YouTube, ou URL signée (1h) du fichier."),
            "expires_in": drf_serializers.IntegerField(required=False)})
_QuizSubmitRequest = inline_serializer(
    name="QuizSubmitRequest",
    fields={"answers": drf_serializers.DictField(
        child=drf_serializers.ListField(child=drf_serializers.IntegerField()),
        help_text="Réponses : { \"<id_question>\": [<id_option>, ...] }.")})
_QuizSubmitResponse = inline_serializer(
    name="QuizSubmitResponse",
    fields={"score": drf_serializers.IntegerField(help_text="Meilleur score conservé (/20)."),
            "last_score": drf_serializers.IntegerField(help_text="Score de cette tentative (/20)."),
            "correct": drf_serializers.IntegerField(), "total": drf_serializers.IntegerField(),
            "attempts": drf_serializers.IntegerField(),
            "validated": drf_serializers.BooleanField(),
            "validated_at": drf_serializers.DateTimeField(allow_null=True),
            "pass_threshold": drf_serializers.IntegerField()})


@extend_schema_view(
    list=extend_schema(
        tags=["Catalogue"], summary="Catalogue des formations",
        description="Liste les formations visibles (publiées, ou programmées dont la date est échue). "
                    "Chaque entrée indique si elle est `locked` (réservée et non accessible au membre).",
        parameters=[OpenApiParameter("category", str, description="Filtre : FORMATION, LIVRE ou LIBRE.")]),
    retrieve=extend_schema(
        tags=["Catalogue"], summary="Détail d'une formation (arbre complet)",
        description="Renvoie l'arbre **modules → sous-modules → cours → ressources**, avec l'état "
                    "d'accès et d'achèvement de chaque nœud, plus l'examen final. Les liens YouTube et "
                    "médias ne sont exposés que pour les cours déverrouillés."),
)
class FormationViewSet(viewsets.ReadOnlyModelViewSet):
    """Catalogue des formations visibles (publiées ou programmées échues) + arbre détaillé."""

    def get_queryset(self):
        qs = visible_formations_qs()
        if category := self.request.query_params.get("category"):
            qs = qs.filter(category=category)
        if self.action == "retrieve":
            qs = qs.prefetch_related(
                "modules__courses__resources", "modules__courses__quiz__questions",
                "modules__children__courses__resources", "modules__children__courses__quiz",
                "final_exam__questions",
            )
        return qs.distinct()

    def get_serializer_class(self):
        return FormationDetailSerializer if self.action == "retrieve" else FormationListSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["accessible_sub_types"] = _accessible_sub_types(self.request.user)
        return ctx


@extend_schema_view(
    list=extend_schema(exclude=True),
    retrieve=extend_schema(exclude=True),
)
class ResourceViewSet(viewsets.ReadOnlyModelViewSet):
    """Lecture d'une ressource : URL signée (fichier) ou lien YouTube, si déverrouillée."""

    def get_queryset(self):
        return Resource.objects.select_related("course__module__formation").filter(
            course__module__formation__in=visible_formations_qs()
        )

    @extend_schema(
        tags=["Catalogue"], summary="Lire une ressource",
        description="Renvoie le moyen de lecture d'une ressource **déverrouillée** : `kind=youtube` "
                    "avec le lien, ou `kind=file` avec une URL signée valable 1h. 403 si la formation "
                    "est réservée (non accessible) ou si le cours n'est pas encore débloqué.",
        responses={200: OpenApiResponse(_StreamResponse, description="Lien de lecture."),
                   400: OpenApiResponse(description="Aucun média rattaché."),
                   403: OpenApiResponse(description="Formation réservée ou cours verrouillé.")},
    )
    @action(detail=True, methods=["get"], url_path="stream")
    def stream(self, request, pk=None):
        """URL de lecture d'une ressource déverrouillée (YouTube ou URL signée 1h)."""
        resource = self.get_object()
        course = resource.course
        formation = course.module.formation
        if not formation_accessible(request.user, formation):
            return Response({"detail": "Formation réservée.", "lock_reason": "subscription"},
                            status=status.HTTP_403_FORBIDDEN)
        if not course_unlocked(request.user, course):
            return Response({"detail": "Cours verrouillé.", "lock_reason": "quiz"},
                            status=status.HTTP_403_FORBIDDEN)
        if resource.is_youtube:
            return Response({"kind": "youtube", "url": resource.youtube_url})
        if not resource.bucket_key:
            return Response({"detail": "Aucun média n'est rattaché à cette ressource."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({"kind": "file", "url": generate_signed_url(resource.bucket_key),
                         "expires_in": 3600})


@extend_schema_view(
    list=extend_schema(exclude=True),
    retrieve=extend_schema(
        tags=["Catalogue"], summary="Énoncé d'un QCM",
        description="Renvoie les questions et options d'un QCM **déverrouillé** (cours débloqué ou "
                    "examen final ouvert). Les bonnes réponses ne sont jamais exposées. 403 si verrouillé."),
)
class QuizViewSet(viewsets.ReadOnlyModelViewSet):
    """Passage des QCM (cours ou examen final) : énoncé, soumission, résultat."""
    queryset = Quiz.objects.filter(active=True)
    serializer_class = QuizPublicSerializer

    def retrieve(self, request, *args, **kwargs):
        quiz = self.get_object()
        access = _quiz_access(request.user, quiz)
        if access["locked"]:
            return Response({"detail": "QCM verrouillé.", **access},
                            status=status.HTTP_403_FORBIDDEN)
        return Response(QuizPublicSerializer(quiz).data)

    @extend_schema(
        tags=["Catalogue"], summary="Soumettre un QCM",
        description="Envoie les réponses du membre, **note côté serveur** (/20), conserve le meilleur "
                    "score, valide si le seuil est atteint (jamais de rétrogradation). Valider le QCM "
                    "d'un cours débloque le suivant ; valider tous les cours ouvre l'examen final.",
        request=_QuizSubmitRequest,
        responses={200: OpenApiResponse(_QuizSubmitResponse, description="Tentative enregistrée."),
                   403: OpenApiResponse(description="QCM verrouillé.")},
    )
    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None):
        """Soumet les réponses, note côté serveur et applique RG-23 à RG-26."""
        quiz = self.get_object()
        access = _quiz_access(request.user, quiz)
        if access["locked"]:
            return Response({"detail": "QCM verrouillé.", **access},
                            status=status.HTTP_403_FORBIDDEN)
        serializer = QuizSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        score, correct, total = grade_quiz(quiz, serializer.validated_data["answers"])
        result = record_quiz_result(request.user, quiz, score)
        return Response({
            "score": result.score, "last_score": score, "correct": correct, "total": total,
            "attempts": result.attempts, "validated": result.validated,
            "validated_at": result.validated_at, "pass_threshold": quiz.pass_threshold,
        })

    @extend_schema(
        tags=["Catalogue"], summary="Mon résultat à un QCM",
        description="Renvoie le résultat du membre pour ce QCM (score, validation), ou un objet vide "
                    "s'il n'a jamais tenté.",
    )
    @action(detail=True, methods=["get"], url_path="result")
    def result(self, request, pk=None):
        """Résultat du membre pour ce QCM (vide si aucune tentative)."""
        quiz = self.get_object()
        result = QuizResult.objects.filter(user=request.user, quiz=quiz).first()
        return Response(QuizResultSerializer(result).data if result else {})

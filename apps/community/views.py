"""Vues membre de la communauté : fil, posts, likes, partage, commentaires, signalements."""
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view, inline_serializer
from rest_framework import generics, serializers as drf_serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Audience, Comment, Like, Post, Report
from .serializers import CommentSerializer, PostSerializer, ReportSerializer
from .services import accessible_audiences, can_access_audience, share_post, toggle_like

_LikeResponse = inline_serializer(
    name="LikeResponse",
    fields={"liked": drf_serializers.BooleanField(), "likes_count": drf_serializers.IntegerField()})


@extend_schema_view(
    list=extend_schema(tags=["Communauté"], summary="Fil communautaire",
                       description="Publications actives accessibles au membre (selon l'audience, RG-30), "
                                   "épinglées en tête puis anti-chronologiques. Les posts programmés "
                                   "n'apparaissent qu'une fois leur date atteinte."),
    create=extend_schema(tags=["Communauté"], summary="Publier"),
    retrieve=extend_schema(tags=["Communauté"], summary="Détail d'une publication"),
    update=extend_schema(tags=["Communauté"], summary="Modifier ma publication"),
    partial_update=extend_schema(tags=["Communauté"], summary="Modifier ma publication (partiel)"),
    destroy=extend_schema(tags=["Communauté"], summary="Supprimer ma publication",
                          description="Suppression logique, réservée à l'auteur (RG-33)."),
)
class PostViewSet(viewsets.ModelViewSet):
    """Fil communautaire filtré par audience (RG-30) + actions like/partage/commentaires."""
    serializer_class = PostSerializer
    permission_classes = [IsAuthenticated]
    queryset = Post.objects.none()  # repli pour l'introspection du type de `id` (schéma)

    def get_queryset(self):
        user = self.request.user
        now = timezone.now()
        likes = Like.objects.filter(post=OuterRef("pk"), user=user)
        return (
            Post.objects.filter(active=True, audience__in=accessible_audiences(user))
            .filter(Q(scheduled_at__isnull=True) | Q(scheduled_at__lte=now))
            .annotate(
                liked_by_me_annot=Exists(likes),
                comments_count_annot=Count("comments", filter=Q(comments__active=True)),
            )
            .select_related("author")
            .order_by("-is_pinned", "-created_at")  # fil : épinglés puis récents
        )

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    def update(self, request, *args, **kwargs):
        post = self.get_object()
        if post.author_id != request.user.id:
            raise PermissionDenied("Vous ne pouvez modifier que vos publications.")
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """Suppression logique de sa propre publication (RG-33)."""
        post = self.get_object()
        if post.author_id != request.user.id:
            raise PermissionDenied("Vous ne pouvez supprimer que vos publications.")
        post.active = False
        post.save(update_fields=["active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(tags=["Communauté"], summary="Aimer / ne plus aimer", request=None,
                   responses={200: OpenApiResponse(_LikeResponse, description="Nouvel état du like.")})
    @action(detail=True, methods=["post"])
    def like(self, request, pk=None):
        post = self.get_object()
        liked, count = toggle_like(request.user, post)
        return Response({"liked": liked, "likes_count": count})

    @extend_schema(tags=["Communauté"], summary="Partager une publication", request=None,
                   responses={201: PostSerializer})
    @action(detail=True, methods=["post"])
    def share(self, request, pk=None):
        post = self.get_object()
        shared = share_post(request.user, post)
        ctx = self.get_serializer_context()
        return Response(PostSerializer(shared, context=ctx).data, status=status.HTTP_201_CREATED)

    @extend_schema(tags=["Communauté"], summary="Commentaires d'une publication",
                   description="GET : liste les commentaires actifs. POST : ajoute un commentaire.",
                   request=CommentSerializer, responses={200: CommentSerializer(many=True)})
    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        post = self.get_object()
        if request.method == "GET":
            qs = post.comments.filter(active=True).select_related("author")
            return Response(CommentSerializer(qs, many=True).data)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(post=post, author=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@extend_schema(tags=["Communauté"], summary="Supprimer mon commentaire",
               description="Suppression logique d'un commentaire, réservée à son auteur.",
               responses={204: OpenApiResponse(description="Commentaire supprimé.")})
class CommentDeleteView(generics.DestroyAPIView):
    """Suppression logique d'un commentaire par son auteur."""
    permission_classes = [IsAuthenticated]
    serializer_class = CommentSerializer

    def get_queryset(self):
        return Comment.objects.filter(author=self.request.user, active=True)

    def perform_destroy(self, instance):
        instance.active = False
        instance.save(update_fields=["active"])


@extend_schema(tags=["Communauté"], summary="Signaler un contenu",
               description="Signale un post ou un commentaire (RG-31). Un même contenu ne peut être "
                           "signalé qu'une fois par membre ; la cible doit être active et accessible.")
class ReportCreateView(generics.CreateAPIView):
    """Signalement d'un post ou commentaire (RG-31)."""
    serializer_class = ReportSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        user = self.request.user
        target_type = serializer.validated_data["target_type"]
        target_id = serializer.validated_data["target_id"]

        # La cible doit exister, être active et accessible au signalant.
        if target_type == Report.TargetType.POST:
            target = Post.objects.filter(id=target_id, active=True).first()
            audience = target.audience if target else None
        else:
            comment = Comment.objects.filter(id=target_id, active=True).select_related("post").first()
            target = comment
            audience = comment.post.audience if comment else None
        if target is None or not can_access_audience(user, audience):
            raise PermissionDenied("Contenu introuvable.")

        if Report.objects.filter(reporter=user, target_type=target_type, target_id=target_id).exists():
            raise PermissionDenied("Vous avez déjà signalé ce contenu.")
        serializer.save(reporter=user)

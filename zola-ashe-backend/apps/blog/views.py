"""Blog : lecture publique (articles publiés) + CRUD admin."""
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.permissions import AllowAny

from apps.admin_api.permissions import IsAdmin

from .models import Article
from .serializers import AdminArticleSerializer, ArticleDetailSerializer, ArticleListSerializer


@extend_schema_view(
    list=extend_schema(tags=["Blog"], summary="Articles publiés",
                       description="Liste publique des articles publiés (accès libre, sans authentification)."),
    retrieve=extend_schema(tags=["Blog"], summary="Article (par slug)",
                           description="Détail d'un article publié, recherché par son `slug`."),
)
class PublicArticleViewSet(viewsets.ReadOnlyModelViewSet):
    """Liste et détail des articles publiés (accès libre). Lookup par slug."""
    permission_classes = [AllowAny]
    authentication_classes = []
    lookup_field = "slug"
    queryset = Article.objects.filter(published=True)

    def get_serializer_class(self):
        return ArticleDetailSerializer if self.action == "retrieve" else ArticleListSerializer


@extend_schema_view(
    list=extend_schema(tags=["Admin · Contenu"], summary="Articles (admin)"),
    create=extend_schema(tags=["Admin · Contenu"], summary="Créer un article"),
    retrieve=extend_schema(tags=["Admin · Contenu"], summary="Détail d'un article (admin)"),
    update=extend_schema(tags=["Admin · Contenu"], summary="Modifier un article"),
    partial_update=extend_schema(tags=["Admin · Contenu"], summary="Modifier un article (partiel)"),
    destroy=extend_schema(tags=["Admin · Contenu"], summary="Supprimer un article"),
)
class AdminArticleViewSet(viewsets.ModelViewSet):
    """CRUD éditorial des articles (réservé admin)."""
    permission_classes = [IsAdmin]
    serializer_class = AdminArticleSerializer
    queryset = Article.objects.all()

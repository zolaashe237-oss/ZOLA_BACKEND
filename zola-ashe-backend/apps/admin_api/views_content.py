"""Back-office — formations, modules, cours, ressources, QCM et annonces (§5.4, §5.6)."""
from uuid import uuid4

from django.core.files.storage import default_storage
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import serializers as drf_serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination

_TAG = "Admin · Contenu"
_DetailResponse = inline_serializer(name="AdminContentDetail", fields={"detail": drf_serializers.CharField()})
_UploadResponse = inline_serializer(
    name="UploadResponse",
    fields={"bucket_key": drf_serializers.CharField(), "size_mo": drf_serializers.FloatField()})
_ScoreRequest = inline_serializer(
    name="AdminQuizScoreRequest",
    fields={"user_id": drf_serializers.IntegerField(), "quiz_id": drf_serializers.IntegerField(),
            "score": drf_serializers.IntegerField(min_value=0, max_value=20)})
_ResetRequest = inline_serializer(
    name="AdminQuizResetRequest",
    fields={"user_id": drf_serializers.IntegerField(), "quiz_id": drf_serializers.IntegerField(),
            "reason": drf_serializers.CharField()})
_PostRequest = inline_serializer(
    name="AdminPostRequest",
    fields={"text": drf_serializers.CharField(required=False),
            "audience": drf_serializers.ChoiceField(choices=["TOUS", "FEMME", "ENFANT"]),
            "is_pinned": drf_serializers.BooleanField(required=False),
            "is_announcement": drf_serializers.BooleanField(required=False),
            "scheduled_at": drf_serializers.DateTimeField(required=False, allow_null=True)})

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.community.models import Post
from apps.content.models import Audio, Course, Formation, FormationStatus, LibraryPdf, Module, Quiz, QuizResult, Resource
from apps.content.services import fetch_youtube_transcript, generate_signed_url, record_quiz_result

from .permissions import IsAdmin
from .serializers import (
    AdminAudioSerializer,
    AdminCourseSerializer,
    AdminFormationSerializer,
    AdminLibraryPdfSerializer,
    AdminModuleSerializer,
    AdminPostSerializer,
    AdminQuizSerializer,
    AdminResourceSerializer,
    QuizScoreSerializer,
    ResetQuizSerializer,
    UploadSerializer,
    AdminQuizResultSerializer,
)

def _auto_fetch_transcript(resource: Resource) -> None:
    """Récupère et stocke la transcription YouTube d'une ressource. Silencieux en cas d'échec."""
    text = fetch_youtube_transcript(resource.youtube_url)
    if text:
        Resource.objects.filter(pk=resource.pk).update(transcript_text=text)


# Limites d'upload (§5.4) : PDF 50 Mo, audio 100 Mo, vidéo 500 Mo, miniature 5 Mo.
_MAX_SIZE = {"PDF": 50 * 1024 * 1024, "AUDIO": 100 * 1024 * 1024,
             "VIDEO": 500 * 1024 * 1024, "IMAGE": 5 * 1024 * 1024}
_PREFIX = {"PDF": "pdfs", "AUDIO": "audios", "VIDEO": "videos", "IMAGE": "thumbnails"}
_MAX_PINNED = 3  # §4.2


class _AuditedContentMixin:
    """Journalise création/modification/suppression à l'audit (RG-21 : traçabilité CMS).

    La sous-classe définit `audit_target_type` (libellé du modèle journalisé).
    """
    audit_target_type: str = ""

    def perform_create(self, serializer):
        obj = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type=self.audit_target_type,
               target_id=obj.id, payload={"created": True})

    def perform_update(self, serializer):
        obj = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type=self.audit_target_type,
               target_id=obj.id)

    def perform_destroy(self, instance):
        record(self.request.user, AuditAction.DELETE_CONTENT, target_type=self.audit_target_type,
               target_id=instance.id)
        instance.delete()


# ─── Documentation détaillée du CRUD Formations (§5.4, RG-20) ────────────────
# La formation est la racine de l'arbre de contenu (Formation → Modules → Cours
# → Ressources). Son cycle de publication : DRAFT (brouillon) → SCHEDULED
# (programmée, `publish_at` requis, mise en ligne par Celery) → PUBLISHED.
_FORMATION_FIELDS_DOC = (
    "**Champs principaux**\n"
    "- `title` *(requis)*, `description`, `category` — `FORMATION`, `LIVRE` ou `LIBRE`.\n"
    "- `access_subscription_types` *(liste)* — `[]` = **publique** (tout membre non bloqué) ; "
    "`[\"MEMBRE\"]` = **réservée** (membre ACTIF requis).\n"
    "- `status` — `DRAFT` (brouillon, masqué), `SCHEDULED` (programmé, `publish_at` **obligatoire**), "
    "`PUBLISHED` (visible).\n"
    "- `publish_at` — date/heure de mise en ligne automatique (requise si `SCHEDULED`).\n"
    "- `cover_url` / `cover_key` — image de couverture (lien ou fichier hébergé), `order` (tri vitrine)."
)
_FORMATION_CREATE_EXAMPLE = OpenApiExample(
    "Formation réservée publiée", request_only=True, value={
        "title": "Programme d'initiation", "description": "Parcours complet en 3 modules.",
        "category": "FORMATION", "access_subscription_types": ["MEMBRE"],
        "status": "PUBLISHED", "order": 1})
_FORMATION_SCHEDULED_EXAMPLE = OpenApiExample(
    "Formation programmée", request_only=True, value={
        "title": "Atelier de juin", "category": "FORMATION", "status": "SCHEDULED",
        "publish_at": "2026-06-01T08:00:00Z", "access_subscription_types": ["MEMBRE"]})


@extend_schema_view(
    list=extend_schema(
        tags=[_TAG], summary="Lister les formations (tous statuts)",
        description="Toutes les formations, **tous statuts confondus** (brouillon/programmé/publié), "
                    "triées par catégorie puis `order`. Vue back-office complète (contrairement au "
                    "catalogue membre qui ne montre que le visible).\n\n" + _FORMATION_FIELDS_DOC),
    create=extend_schema(
        tags=[_TAG], summary="Créer une formation",
        description="Crée une formation. Pour une mise en ligne différée, utiliser `status=SCHEDULED` "
                    "avec `publish_at` (sinon `400`). Une formation `[]` est publique, `[\"MEMBRE\"]` "
                    "est réservée.\n\n" + _FORMATION_FIELDS_DOC,
        examples=[_FORMATION_CREATE_EXAMPLE, _FORMATION_SCHEDULED_EXAMPLE],
        responses={201: OpenApiResponse(AdminFormationSerializer, description="Formation créée."),
                   400: OpenApiResponse(_DetailResponse, description="`publish_at` manquant pour un statut programmé, etc.")}),
    retrieve=extend_schema(tags=[_TAG], summary="Détail d'une formation (admin)",
                           description="Renvoie une formation et son nombre de modules.\n\n" + _FORMATION_FIELDS_DOC),
    update=extend_schema(tags=[_TAG], summary="Remplacer une formation (PUT)",
                         description="Remplace tous les champs.\n\n" + _FORMATION_FIELDS_DOC,
                         examples=[_FORMATION_CREATE_EXAMPLE]),
    partial_update=extend_schema(tags=[_TAG], summary="Modifier une formation (PATCH partiel)",
                                 description="Modifie un sous-ensemble de champs (ex. `order`, `status`).",
                                 examples=[OpenApiExample("Reclasser", request_only=True, value={"order": 2})]),
    destroy=extend_schema(tags=[_TAG], summary="Dépublier une formation",
                          description="**Suppression logique** (RG-20) : la formation n'est pas effacée, elle "
                                      "repasse en brouillon (`DRAFT`) et disparaît du catalogue. Réponse `204`.",
                          responses={204: OpenApiResponse(description="Formation dépubliée (repassée en brouillon).")}),
)
class AdminFormationViewSet(viewsets.ModelViewSet):
    """CRUD des formations (brouillon, programmé, publié)."""
    serializer_class = AdminFormationSerializer
    permission_classes = [IsAdmin]
    queryset = Formation.objects.all().order_by("category", "order")

    def perform_create(self, serializer):
        formation = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="Formation",
               target_id=formation.id, payload={"created": True})

    def perform_update(self, serializer):
        formation = serializer.save()
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="Formation",
               target_id=formation.id)

    def destroy(self, request, *args, **kwargs):
        """Suppression logique (RG-20) : la formation repasse en brouillon (dépubliée)."""
        formation = self.get_object()
        formation.status = FormationStatus.DRAFT
        formation.save(update_fields=["status"])
        record(request.user, AuditAction.DELETE_CONTENT, target_type="Formation", target_id=formation.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(tags=[_TAG], summary="Publier maintenant",
                   description="Force la publication immédiate de la formation (statut PUBLISHED).",
                   request=None, responses={200: AdminFormationSerializer})
    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request, pk=None):
        """Publie immédiatement la formation."""
        formation = self.get_object()
        formation.status = FormationStatus.PUBLISHED
        formation.publish_at = None
        formation.save(update_fields=["status", "publish_at"])
        record(request.user, AuditAction.UPDATE_CONTENT, target_type="Formation",
               target_id=formation.id, payload={"published": True})
        return Response(AdminFormationSerializer(formation).data)

    @extend_schema(
        tags=[_TAG],
        summary="Uploader la couverture d'une formation",
        description="Uploade une image de couverture pour la formation (max 5 Mo).",
        request=inline_serializer(name="FormationCoverRequest", fields={"file": drf_serializers.FileField()}),
        responses={200: inline_serializer(name="FormationCoverResponse", fields={"url": drf_serializers.CharField(), "key": drf_serializers.CharField()})}
    )
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser], url_path="cover")
    def upload_cover(self, request, pk=None):
        """Uploade et met à jour l'image de couverture d'une formation."""
        formation = self.get_object()
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "Aucun fichier fourni."}, status=status.HTTP_400_BAD_REQUEST)
        
        # Enforce size constraint (5MB for images)
        if file.size > 5 * 1024 * 1024:
            return Response({"detail": "Fichier de couverture trop volumineux (max 5 Mo)."},
                            status=status.HTTP_400_BAD_REQUEST)
        
        key = f"thumbnails/{uuid4().hex}_{file.name}"
        saved_key = default_storage.save(key, file)
        
        formation.cover_key = saved_key
        formation.cover_url = ""  # On vide cover_url pour utiliser cover_key
        formation.save(update_fields=["cover_key", "cover_url"])
        
        signed_url = generate_signed_url(saved_key)
        record(request.user, AuditAction.UPDATE_CONTENT, target_type="Formation",
               target_id=formation.id, payload={"cover_updated": True})
               
        return Response({"url": signed_url, "key": saved_key}, status=status.HTTP_200_OK)


# ─── Documentation détaillée du CRUD Modules (arbre) ─────────────────────────
_MODULE_FIELDS_DOC = (
    "**Champs principaux**\n"
    "- `formation` *(int, requis)* — formation racine.\n"
    "- `parent` *(int, optionnel)* — module parent **dans la même formation** → arborescence de "
    "sous-modules. `null` = module de premier niveau. Un module ne peut être son propre parent.\n"
    "- `title` *(requis)*, `description`, `order` *(tri entre frères)*."
)
_MODULE_EXAMPLE = OpenApiExample("Sous-module", request_only=True, value={
    "formation": 12, "parent": 30, "title": "Fondations", "order": 1})


@extend_schema_view(
    list=extend_schema(
        tags=[_TAG], summary="Lister les modules d'une formation",
        description="Modules triés par formation puis `order`. **Filtrer** avec `?formation=<id>`.\n\n"
                    + _MODULE_FIELDS_DOC,
        parameters=[OpenApiParameter("formation", OpenApiTypes.INT, OpenApiParameter.QUERY,
                                     description="Ne renvoie que les modules de cette formation.")]),
    create=extend_schema(
        tags=[_TAG], summary="Créer un module (ou sous-module via `parent`)",
        description="Crée un module de premier niveau, ou un sous-module en renseignant `parent` "
                    "(qui doit appartenir à la même formation, sinon `400`).\n\n" + _MODULE_FIELDS_DOC,
        examples=[_MODULE_EXAMPLE],
        responses={201: OpenApiResponse(AdminModuleSerializer, description="Module créé."),
                   400: OpenApiResponse(_DetailResponse, description="Parent d'une autre formation, ou auto-référence.")}),
    retrieve=extend_schema(tags=[_TAG], summary="Détail d'un module", description=_MODULE_FIELDS_DOC),
    update=extend_schema(tags=[_TAG], summary="Remplacer un module (PUT)", description=_MODULE_FIELDS_DOC),
    partial_update=extend_schema(tags=[_TAG], summary="Modifier un module (PATCH partiel)",
                                 description="Pratique pour **réordonner** (`order`) ou rattacher à un autre `parent`.",
                                 examples=[OpenApiExample("Réordonner", request_only=True, value={"order": 2})]),
    destroy=extend_schema(tags=[_TAG], summary="Supprimer un module (et son contenu)",
                          description="Suppression en cascade : sous-modules, cours et ressources rattachés "
                                      "sont supprimés. Réponse `204`.",
                          responses={204: OpenApiResponse(description="Module supprimé.")}),
)
class AdminModuleViewSet(_AuditedContentMixin, viewsets.ModelViewSet):
    """CRUD des modules d'une formation, avec arborescence de sous-modules (`parent`)."""
    serializer_class = AdminModuleSerializer
    permission_classes = [IsAdmin]
    queryset = Module.objects.all().order_by("formation", "order")
    audit_target_type = "Module"

    def get_queryset(self):
        qs = super().get_queryset()
        if formation := self.request.query_params.get("formation"):
            qs = qs.filter(formation_id=formation)
        return qs


# ─── Documentation détaillée du CRUD Cours ───────────────────────────────────
_COURSE_FIELDS_DOC = (
    "**Champs principaux**\n"
    "- `module` *(int, requis)* — module (ou sous-module) auquel le cours appartient.\n"
    "- `title` *(requis)*, `description`, `order` *(tri dans le module)*.\n\n"
    "Un cours porte ensuite des **ressources** (`/resources/`) et, éventuellement, un **QCM** "
    "(`/quizzes/`) à valider pour débloquer le cours suivant."
)
_COURSE_EXAMPLE = OpenApiExample("Cours", request_only=True, value={
    "module": 30, "title": "Leçon 1 — Les bases", "order": 1})


@extend_schema_view(
    list=extend_schema(
        tags=[_TAG], summary="Lister les cours d'un module",
        description="Cours triés par module puis `order`. **Filtrer** avec `?module=<id>`.\n\n"
                    + _COURSE_FIELDS_DOC,
        parameters=[OpenApiParameter("module", OpenApiTypes.INT, OpenApiParameter.QUERY,
                                     description="Ne renvoie que les cours de ce module.")]),
    create=extend_schema(tags=[_TAG], summary="Créer un cours", description=_COURSE_FIELDS_DOC,
                         examples=[_COURSE_EXAMPLE],
                         responses={201: OpenApiResponse(AdminCourseSerializer, description="Cours créé.")}),
    retrieve=extend_schema(tags=[_TAG], summary="Détail d'un cours", description=_COURSE_FIELDS_DOC),
    update=extend_schema(tags=[_TAG], summary="Remplacer un cours (PUT)", description=_COURSE_FIELDS_DOC),
    partial_update=extend_schema(tags=[_TAG], summary="Modifier un cours (PATCH partiel)",
                                 description="Pratique pour **réordonner** (`order`) ou renommer.",
                                 examples=[OpenApiExample("Réordonner", request_only=True, value={"order": 3})]),
    destroy=extend_schema(tags=[_TAG], summary="Supprimer un cours",
                          description="Suppression en cascade des ressources et du QCM du cours. Réponse `204`.",
                          responses={204: OpenApiResponse(description="Cours supprimé.")}),
)
class AdminCourseViewSet(_AuditedContentMixin, viewsets.ModelViewSet):
    """CRUD des cours d'un module : porte les ressources et un QCM optionnel."""
    serializer_class = AdminCourseSerializer
    permission_classes = [IsAdmin]
    queryset = Course.objects.all().order_by("module", "order")
    audit_target_type = "Course"

    def get_queryset(self):
        qs = super().get_queryset()
        if module := self.request.query_params.get("module"):
            qs = qs.filter(module_id=module)
        return qs


# ─── Documentation détaillée du CRUD Ressources (§5.4, RG-16/17) ─────────────
# Une « ressource » est le média rattaché à un cours : vidéo (lien YouTube OU
# fichier hébergé), PDF, audio ou texte. Workflow en deux temps pour un fichier :
#   1) POST /api/admin/content/upload/  → renvoie une `bucket_key`
#   2) POST /api/admin/resources/ avec cette `bucket_key`
# Pour une vidéo YouTube, aucun upload : `video_source=YOUTUBE` + `youtube_url`.

_RESOURCE_FIELDS_DOC = (
    "**Champs principaux**\n"
    "- `course` *(int, requis)* — cours auquel la ressource est rattachée.\n"
    "- `resource_type` *(requis)* — `VIDEO`, `PDF`, `AUDIO` ou `TEXTE`.\n"
    "- `title` *(requis)*, `description`, `order` *(tri dans le cours)*.\n"
    "- `video_source` — `YOUTUBE` (lien externe) ou `UPLOAD` (fichier hébergé). "
    "Si `VIDEO` + `YOUTUBE`, le champ `youtube_url` est **obligatoire** (validé côté serveur).\n"
    "- `youtube_url` — lien YouTube (watch ou youtu.be) quand `video_source=YOUTUBE`.\n"
    "- `bucket_key` — clé renvoyée par `/content/upload/` pour un média hébergé "
    "(vidéo UPLOAD, PDF, audio).\n"
    "- `thumbnail_url` / `thumbnail_key` — miniature (lien ou fichier hébergé).\n"
    "- métadonnées : `nb_pages` (PDF), `duration_sec` (vidéo/audio), `size_mo`, `audio_format`."
)

_RES_YT_EXAMPLE = OpenApiExample(
    "Vidéo YouTube", value={
        "course": 12, "resource_type": "VIDEO", "video_source": "YOUTUBE",
        "youtube_url": "https://www.youtube.com/watch?v=ScMzIvxBSi4",
        "title": "Introduction au programme", "description": "Vidéo d'accueil.", "order": 1,
    }, request_only=True)
_RES_FILE_EXAMPLE = OpenApiExample(
    "Fichier hébergé (PDF)", value={
        "course": 12, "resource_type": "PDF", "title": "Support PDF",
        "bucket_key": "pdfs/3f2a…_support.pdf", "nb_pages": 24, "size_mo": 1.8, "order": 2,
    }, request_only=True)
_RES_RESPONSE_EXAMPLE = OpenApiExample(
    "Ressource créée", value={
        "id": 87, "course": 12, "resource_type": "VIDEO", "title": "Introduction au programme",
        "description": "Vidéo d'accueil.", "order": 1, "video_source": "YOUTUBE",
        "youtube_url": "https://www.youtube.com/watch?v=ScMzIvxBSi4", "bucket_key": "",
        "thumbnail_url": "", "thumbnail_key": "", "thumbnail": "", "nb_pages": None,
        "duration_sec": None, "size_mo": None, "audio_format": "",
        "created_at": "2026-05-24T10:00:00Z",
    }, response_only=True)


@extend_schema_view(
    list=extend_schema(
        tags=[_TAG], summary="Lister les ressources d'un cours",
        description="Liste les ressources, triées par `order`. **Filtrer par cours** avec "
                    "`?course=<id>` pour récupérer le contenu d'un cours précis.\n\n" + _RESOURCE_FIELDS_DOC,
        parameters=[OpenApiParameter("course", OpenApiTypes.INT, OpenApiParameter.QUERY,
                                     description="Ne renvoie que les ressources de ce cours.")],
        examples=[_RES_RESPONSE_EXAMPLE]),
    create=extend_schema(
        tags=[_TAG], summary="Créer une ressource (lien YouTube ou fichier hébergé)",
        description="Crée une ressource dans un cours.\n\n"
                    "**Deux modes de média :**\n"
                    "1. *Lien YouTube* — `resource_type=VIDEO`, `video_source=YOUTUBE`, "
                    "`youtube_url` requis (aucun upload).\n"
                    "2. *Fichier hébergé* — d'abord `POST /content/upload/` (renvoie une `bucket_key`), "
                    "puis créer la ressource avec cette `bucket_key` "
                    "(`VIDEO`+`UPLOAD`, `PDF` ou `AUDIO`).\n\n" + _RESOURCE_FIELDS_DOC,
        examples=[_RES_YT_EXAMPLE, _RES_FILE_EXAMPLE, _RES_RESPONSE_EXAMPLE],
        responses={201: OpenApiResponse(AdminResourceSerializer, description="Ressource créée."),
                   400: OpenApiResponse(_DetailResponse,
                                        description="Validation : lien YouTube manquant, cours absent, etc.")}),
    retrieve=extend_schema(
        tags=[_TAG], summary="Détail d'une ressource",
        description="Renvoie une ressource avec son média (lien YouTube ou clé de fichier) et "
                    "l'URL signée de sa miniature.\n\n" + _RESOURCE_FIELDS_DOC,
        examples=[_RES_RESPONSE_EXAMPLE]),
    update=extend_schema(
        tags=[_TAG], summary="Remplacer une ressource (PUT)",
        description="Remplace l'intégralité des champs de la ressource. Permet de **basculer le média** "
                    "(passer d'un lien YouTube à un fichier hébergé et inversement).\n\n" + _RESOURCE_FIELDS_DOC,
        examples=[_RES_YT_EXAMPLE, _RES_FILE_EXAMPLE]),
    partial_update=extend_schema(
        tags=[_TAG], summary="Modifier une ressource (PATCH partiel)",
        description="Modifie un sous-ensemble de champs : utile pour **réordonner** (`order`), "
                    "renommer, ou changer la miniature sans toucher au reste.",
        examples=[OpenApiExample("Réordonner", value={"order": 3}, request_only=True),
                  OpenApiExample("Changer le lien", request_only=True,
                                 value={"youtube_url": "https://youtu.be/nouveau"})]),
    destroy=extend_schema(
        tags=[_TAG], summary="Supprimer une ressource",
        description="Suppression définitive de la ressource (le média hébergé éventuel reste dans le "
                    "bucket et peut être réutilisé). Réponse `204 No Content`.",
        responses={204: OpenApiResponse(description="Ressource supprimée.")}),
)
class AdminResourceViewSet(viewsets.ModelViewSet):
    """CRUD complet des ressources d'un cours : vidéo YouTube, fichier hébergé, PDF, audio (§5.4)."""
    serializer_class = AdminResourceSerializer
    permission_classes = [IsAdmin]
    queryset = Resource.objects.all().order_by("course", "order")

    def get_queryset(self):
        qs = super().get_queryset()
        if course := self.request.query_params.get("course"):
            qs = qs.filter(course_id=course)
        return qs

    def perform_create(self, serializer):
        resource = serializer.save()
        if resource.is_youtube and resource.youtube_url:
            _auto_fetch_transcript(resource)
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="Resource",
               target_id=resource.id, payload={"created": True, "course_id": resource.course_id})

    def perform_update(self, serializer):
        prev_url = serializer.instance.youtube_url
        resource = serializer.save()
        if resource.is_youtube and resource.youtube_url and resource.youtube_url != prev_url:
            _auto_fetch_transcript(resource)
        record(self.request.user, AuditAction.UPDATE_CONTENT, target_type="Resource",
               target_id=resource.id)

    def perform_destroy(self, instance):
        record(self.request.user, AuditAction.DELETE_CONTENT, target_type="Resource",
               target_id=instance.id)
        instance.delete()

    @extend_schema(
        tags=[_TAG], summary="Prévisualiser le média hébergé (admin)",
        description="Renvoie une **URL signée** (valable 1h) du fichier hébergé de la ressource, "
                    "**sans contrôle d'abonnement** : réservé à l'aperçu admin avant publication. "
                    "`400` si la ressource n'a pas de fichier (ex. vidéo YouTube).",
        responses={200: OpenApiResponse(
            inline_serializer(name="ResourcePreviewResponse",
                              fields={"url": drf_serializers.CharField(),
                                      "resource_type": drf_serializers.CharField()}),
            description="URL signée du média."),
            400: OpenApiResponse(_DetailResponse, description="Aucun média hébergé.")})
    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None):
        """URL signée du média hébergé pour prévisualisation admin."""
        resource = self.get_object()
        if not resource.bucket_key:
            return Response({"detail": "Aucun média hébergé sur cette ressource."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({"url": generate_signed_url(resource.bucket_key),
                         "resource_type": resource.resource_type})


# ─── Documentation détaillée du CRUD QCM (édition imbriquée, RG-23/27) ───────
# Un QCM est rattaché SOIT à un cours (QCM de cours, à valider pour avancer),
# SOIT à une formation (examen final, ouvert quand tous les cours sont validés).
# Les questions et options sont éditées en une fois (réécriture complète).
_QUIZ_FIELDS_DOC = (
    "**Champs principaux**\n"
    "- `course` **XOR** `formation` *(requis)* — exactement un des deux : `course` pour un QCM de "
    "cours, `formation` pour l'**examen final**. Renseigner les deux (ou aucun) renvoie `400`.\n"
    "- `title` *(requis)*, `pass_threshold` *(seuil de validation /20, défaut 10)*, `active`.\n"
    "- `questions` *(liste imbriquée)* — chaque question : `text`, `multiple` (réponses multiples ?), "
    "`order`, et `choices` : liste d'options `{text, is_correct, order}`.\n\n"
    "À l'`update`, fournir `questions` **réécrit l'intégralité** des questions/options (remplacement, "
    "pas de fusion). Les bonnes réponses (`is_correct`) ne sont jamais exposées côté membre."
)
_QUIZ_EXAMPLE = OpenApiExample(
    "QCM de cours (2 options)", request_only=True, value={
        "course": 12, "title": "QCM — Leçon 1", "pass_threshold": 15, "active": True,
        "questions": [{
            "text": "Quelle est la bonne réponse ?", "multiple": False, "order": 1,
            "choices": [{"text": "Réponse correcte", "is_correct": True, "order": 1},
                        {"text": "Réponse fausse", "is_correct": False, "order": 2}]}]})
_EXAM_EXAMPLE = OpenApiExample(
    "Examen final (rattaché à la formation)", request_only=True, value={
        "formation": 12, "title": "Examen final", "pass_threshold": 12, "active": True, "questions": []})


@extend_schema_view(
    list=extend_schema(
        tags=[_TAG], summary="Lister les QCM",
        description="QCM avec questions/options préchargées. **Filtrer** par `?course=<id>` (QCM d'un "
                    "cours) ou `?formation=<id>` (QCM de la formation + examen final).\n\n" + _QUIZ_FIELDS_DOC,
        parameters=[OpenApiParameter("course", OpenApiTypes.INT, OpenApiParameter.QUERY,
                                     description="QCM rattaché à ce cours."),
                    OpenApiParameter("formation", OpenApiTypes.INT, OpenApiParameter.QUERY,
                                     description="QCM de la formation (cours + examen final).")]),
    create=extend_schema(
        tags=[_TAG], summary="Créer un QCM (questions/options imbriquées)",
        description="Crée un QCM rattaché à un `course` (QCM de cours) **OU** à une `formation` "
                    "(examen final), avec ses questions et options en une seule requête.\n\n" + _QUIZ_FIELDS_DOC,
        examples=[_QUIZ_EXAMPLE, _EXAM_EXAMPLE],
        responses={201: OpenApiResponse(AdminQuizSerializer, description="QCM créé."),
                   400: OpenApiResponse(_DetailResponse, description="`course` et `formation` tous deux fournis (ou aucun).")}),
    retrieve=extend_schema(tags=[_TAG], summary="Détail d'un QCM (avec questions/options)",
                           description=_QUIZ_FIELDS_DOC),
    update=extend_schema(tags=[_TAG], summary="Remplacer un QCM (PUT — réécrit les questions)",
                         description="Fournir `questions` **réécrit toutes** les questions/options.\n\n" + _QUIZ_FIELDS_DOC,
                         examples=[_QUIZ_EXAMPLE]),
    partial_update=extend_schema(tags=[_TAG], summary="Modifier un QCM (PATCH partiel)",
                                 description="Modifie des champs simples (`title`, `pass_threshold`, `active`) "
                                             "sans réécrire les questions si `questions` est omis.",
                                 examples=[OpenApiExample("Ajuster le seuil", request_only=True,
                                                          value={"pass_threshold": 12, "active": True})]),
    destroy=extend_schema(tags=[_TAG], summary="Supprimer un QCM",
                          description="Supprime le QCM et ses questions/options. Réponse `204`.",
                          responses={204: OpenApiResponse(description="QCM supprimé.")}),
)
class AdminQuizViewSet(_AuditedContentMixin, viewsets.ModelViewSet):
    """CRUD des QCM avec questions/options imbriquées (cours ou examen final)."""
    serializer_class = AdminQuizSerializer
    permission_classes = [IsAdmin]
    queryset = Quiz.objects.all().prefetch_related("questions__choices")
    audit_target_type = "Quiz"

    def get_queryset(self):
        qs = super().get_queryset()
        if formation := self.request.query_params.get("formation"):
            qs = qs.filter(course__module__formation_id=formation) | qs.filter(formation_id=formation)
        if course := self.request.query_params.get("course"):
            qs = qs.filter(course_id=course)
        return qs.distinct()


@extend_schema(tags=[_TAG], summary="Uploader un média",
               description="Envoie un fichier (VIDEO/PDF/AUDIO/IMAGE) vers le stockage objet (MinIO/R2) "
                           "et renvoie sa clé `bucket_key`, à rattacher ensuite à une ressource. "
                           "Limites : PDF 50 Mo, audio 100 Mo, vidéo 500 Mo, image 5 Mo.",
               request=UploadSerializer,
               responses={201: OpenApiResponse(_UploadResponse, description="Fichier stocké.")})
class ContentUploadView(APIView):
    """Upload d'un fichier vidéo/PDF/audio vers le bucket (MinIO/R2). Retourne la clé."""
    permission_classes = [IsAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = UploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = serializer.validated_data["file"]
        ctype = serializer.validated_data["content_type"]
        if file.size > _MAX_SIZE[ctype]:
            limit = _MAX_SIZE[ctype] // (1024 * 1024)
            return Response({"detail": f"Fichier trop volumineux (max {limit} Mo)."},
                            status=status.HTTP_400_BAD_REQUEST)
        key = f"{_PREFIX[ctype]}/{uuid4().hex}_{file.name}"
        saved = default_storage.save(key, file)
        return Response({"bucket_key": saved, "size_mo": round(file.size / (1024 * 1024), 2)},
                        status=status.HTTP_201_CREATED)


@extend_schema(tags=[_TAG], summary="Saisir un score de QCM (admin)",
               description="Enregistre manuellement un score (/20) pour un membre sur un QCM donné (§5.6).",
               request=_ScoreRequest, responses={200: _DetailResponse})
class QuizScoreView(APIView):
    """Saisie manuelle d'un score de QCM pour un membre (§5.6)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        serializer = QuizScoreSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        quiz = Quiz.objects.filter(id=data["quiz_id"]).first()
        if quiz is None:
            return Response({"detail": "QCM introuvable."}, status=status.HTTP_404_NOT_FOUND)
        from apps.accounts.models import User
        user = User.objects.filter(id=data["user_id"]).first()
        if user is None:
            return Response({"detail": "Membre introuvable."}, status=status.HTTP_404_NOT_FOUND)
        result = record_quiz_result(user, quiz, data["score"])
        return Response({"score": result.score, "validated": result.validated})


@extend_schema(tags=[_TAG], summary="Réinitialiser un QCM pour un membre",
               description="Remet à zéro les tentatives/score d'un membre sur un QCM (RG-27). Motif requis, journalisé.",
               request=_ResetRequest, responses={200: _DetailResponse})
class ResetQuizView(APIView):
    """Réinitialise les tentatives d'un membre pour un QCM (RG-27, motif requis)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        serializer = ResetQuizSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = QuizResult.objects.filter(
            user_id=data["user_id"], quiz_id=data["quiz_id"]).first()
        if result is None:
            return Response({"detail": "Aucun résultat à réinitialiser."}, status=status.HTTP_404_NOT_FOUND)
        result.validated = False
        result.score = 0
        result.attempts = 0
        result.validated_at = None
        result.save()
        record(request.user, AuditAction.RESET_QUIZ, target_type="QuizResult", target_id=result.id,
               reason=data["reason"], payload={"user_id": data["user_id"], "quiz_id": data["quiz_id"]})
        return Response({"detail": "QCM réinitialisé."})


@extend_schema(tags=["Admin · Modération & Audit"], summary="Publier une annonce (admin)",
               description="Crée une publication admin : annonce, post épinglé (max 3) ou programmé (§5.4).",
               request=_PostRequest,
               responses={201: inline_serializer(name="AdminPostCreated",
                                                  fields={"id": drf_serializers.IntegerField()})})
class AdminPostCreateView(APIView):
    """Publication admin : annonce / post épinglé / programmé (§5.4)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        serializer = AdminPostSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["is_pinned"] and Post.objects.filter(is_pinned=True, active=True).count() >= _MAX_PINNED:
            return Response({"detail": f"Maximum {_MAX_PINNED} posts épinglés."},
                            status=status.HTTP_400_BAD_REQUEST)
        post = Post.objects.create(
            author=request.user,
            text=data.get("text", ""),
            audience=data["audience"],
            is_pinned=data["is_pinned"],
            is_announcement=data["is_announcement"],
            scheduled_at=data.get("scheduled_at"),
        )
        return Response({"id": post.id}, status=status.HTTP_201_CREATED)


# ─── Audiothèque ─────────────────────────────────────────────────────────────

class AdminAudioViewSet(_AuditedContentMixin, viewsets.ModelViewSet):
    """CRUD de l'audiothèque standalone (méditations, cours audio, contes)."""
    serializer_class = AdminAudioSerializer
    permission_classes = [IsAdmin]
    queryset = Audio.objects.all().order_by("-created_at")
    audit_target_type = "Audio"

    def get_queryset(self):
        qs = super().get_queryset()
        if branche := self.request.query_params.get("branche"):
            qs = qs.filter(branche=branche)
        if active := self.request.query_params.get("is_active"):
            qs = qs.filter(is_active=active.lower() == "true")
        return qs


# ─── Bibliothèque PDF ─────────────────────────────────────────────────────────

class AdminLibraryPdfViewSet(_AuditedContentMixin, viewsets.ModelViewSet):
    """CRUD de la bibliothèque PDF standalone (guides, livrets, supports)."""
    serializer_class = AdminLibraryPdfSerializer
    permission_classes = [IsAdmin]
    queryset = LibraryPdf.objects.all().order_by("-created_at")
    audit_target_type = "LibraryPdf"

    def get_queryset(self):
        qs = super().get_queryset()
        if branche := self.request.query_params.get("branche"):
            qs = qs.filter(branche=branche)
        if active := self.request.query_params.get("is_active"):
            qs = qs.filter(is_active=active.lower() == "true")
        return qs


class AdminQuizResultPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class AdminQuizResultListView(APIView):
    permission_classes = [IsAdmin]
    pagination_class = AdminQuizResultPagination

    def get(self, request):
        params = request.query_params
        qs = QuizResult.objects.select_related("user", "quiz").order_by("-validated_at")
        
        quiz_id = params.get("quiz_id")
        if quiz_id:
            qs = qs.filter(quiz_id=quiz_id)
            
        search = params.get("search")
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(user__email__icontains=search) |
                Q(user__full_name__icontains=search) |
                Q(quiz__title__icontains=search)
            )
            
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        if page is not None:
            serializer = AdminQuizResultSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
            
        serializer = AdminQuizResultSerializer(qs, many=True)
        return Response(serializer.data)


# ── Import YouTube ─────────────────────────────────────────────────────────────

class YoutubeImportView(APIView):
    """
    POST /api/admin/formations/import-youtube/

    Corps :
        { "playlist_url": "https://youtube.com/playlist?list=...", "mode": "preview" | "confirm" }

    • mode=preview  → analyse la playlist via YouTube Data API, renvoie la structure sans écrire en base
    • mode=confirm  → re-fetch + crée Formation / Module / Course / Resource en base
    """

    permission_classes = [IsAdmin]

    @extend_schema(
        tags=[_TAG],
        summary="Importer une formation depuis une playlist YouTube",
        request=inline_serializer(
            name="YoutubeImportRequest",
            fields={
                "playlist_url": drf_serializers.URLField(),
                "mode": drf_serializers.ChoiceField(choices=["preview", "confirm"]),
            },
        ),
        responses={
            200: OpenApiResponse(description="Preview ou résultat de l'import"),
            400: OpenApiResponse(description="URL invalide ou mode inconnu"),
            503: OpenApiResponse(description="YouTube API indisponible / clé manquante"),
        },
    )
    def post(self, request):
        from . import youtube_import as yt_service

        playlist_url = (request.data.get("playlist_url") or "").strip()
        mode         = (request.data.get("mode") or "").strip()

        if not playlist_url:
            return Response(
                {"detail": "Le champ `playlist_url` est requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not yt_service.extract_playlist_id(playlist_url):
            return Response(
                {"detail": "URL invalide — le paramètre `list=` est introuvable."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if mode not in ("preview", "confirm"):
            return Response(
                {"detail": "Le champ `mode` doit valoir 'preview' ou 'confirm'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        import_mode = (request.data.get("import_mode") or "formation").strip()

        try:
            if mode == "preview":
                data = yt_service.preview_playlist(playlist_url)
            elif import_mode == "chapter":
                formation_id = request.data.get("formation_id")
                if not formation_id:
                    return Response(
                        {"detail": "Le champ `formation_id` est requis pour import_mode=chapter."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                try:
                    from apps.content.models import Formation
                    Formation.objects.get(pk=int(formation_id))
                except (ValueError, Formation.DoesNotExist):
                    return Response(
                        {"detail": f"Formation {formation_id} introuvable."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                data = yt_service.import_playlist_as_chapter(playlist_url, int(formation_id))
            else:
                data = yt_service.import_playlist(playlist_url)
            return Response(data)

        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            import logging
            logging.getLogger("admin_api.youtube").exception(
                "Erreur import YouTube url=%s mode=%s import_mode=%s",
                playlist_url, mode, import_mode,
            )
            return Response(
                {"detail": f"Service YouTube indisponible : {exc}"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

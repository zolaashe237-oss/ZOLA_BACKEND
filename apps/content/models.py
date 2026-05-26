"""Contenus pédagogiques — Formation → Modules (arbre) → Cours → Ressources + QCM.

Hiérarchie (livret §11/§12) :

    Formation (entrée du catalogue)     statut de publication (programmable), accès
      └─ Module (arborescence)          module → sous-module (parent/enfant), ordonné
           └─ Course « Cours »          plusieurs par (sous-)module, ordonnés
                ├─ Resource (média)     VIDEO (YouTube ou fichier), PDF, AUDIO
                └─ Quiz (QCM du cours)  débloque le cours suivant
      └─ Quiz (examen final)            au niveau de la Formation

Accès : `Formation.access_subscription_types` (liste vide = public, `["MEMBRE"]` =
réservé aux membres actifs). Le streaming des fichiers hébergés passe toujours par
une URL signée ; les vidéos YouTube exposent leur URL d'intégration.
"""
from django.db import models
from django.utils import timezone


class Category(models.TextChoices):
    """Catégorie de catalogue (rangement, sans effet d'accès)."""
    LIVRE = "LIVRE", "Livre"
    FORMATION = "FORMATION", "Formation"
    LIBRE = "LIBRE", "Accès libre"


class FormationStatus(models.TextChoices):
    """Cycle de publication d'une formation (programmation en ligne)."""
    DRAFT = "DRAFT", "Brouillon"
    SCHEDULED = "SCHEDULED", "Programmé"
    PUBLISHED = "PUBLISHED", "Publié"


class ResourceType(models.TextChoices):
    VIDEO = "VIDEO", "Vidéo"
    PDF = "PDF", "PDF"
    AUDIO = "AUDIO", "Audio"


class VideoSource(models.TextChoices):
    """Origine d'une vidéo : lien YouTube ou fichier hébergé (MinIO/R2)."""
    YOUTUBE = "YOUTUBE", "Lien YouTube"
    UPLOAD = "UPLOAD", "Fichier hébergé"


class Formation(models.Model):
    """Formation : unité du catalogue, organisée en modules et programmable."""
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=10, choices=Category.choices, default=Category.FORMATION)
    # Accès : liste vide = PUBLIC (tout membre non bloqué) ; ["MEMBRE"] = RÉSERVÉ
    # (membre actif). Codes de billing.SubscriptionType (RG-22).
    access_subscription_types = models.JSONField(default=list, blank=True)

    cover_url = models.URLField(blank=True)                   # couverture externe (legacy/seed)
    cover_key = models.CharField(max_length=512, blank=True)  # couverture hébergée (signée)

    # Publication programmable (§5.4) : DRAFT → SCHEDULED (publish_at) → PUBLISHED.
    status = models.CharField(max_length=10, choices=FormationStatus.choices,
                              default=FormationStatus.DRAFT)
    publish_at = models.DateTimeField(null=True, blank=True)

    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "formations"
        ordering = ["category", "order", "id"]
        indexes = [models.Index(fields=["category", "status"])]

    def __str__(self):
        return self.title

    @property
    def is_reserved(self) -> bool:
        return bool(self.access_subscription_types)

    @property
    def is_visible(self) -> bool:
        """Visible des membres ? (publiée, ou programmée échue)"""
        if self.status == FormationStatus.PUBLISHED:
            return True
        if self.status == FormationStatus.SCHEDULED and self.publish_at:
            return self.publish_at <= timezone.now()
        return False


class Module(models.Model):
    """Module d'une formation, organisé en arborescence (module → sous-module)."""
    formation = models.ForeignKey(Formation, on_delete=models.CASCADE, related_name="modules")
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "modules"
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["formation", "parent", "order"])]

    def __str__(self):
        return f"{self.formation_id} · {self.title}"


class Course(models.Model):
    """« Cours » : unité d'apprentissage d'un (sous-)module, regroupant des
    ressources et un QCM optionnel. Plusieurs cours par module, ordonnés."""
    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="courses")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "courses"
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["module", "order"])]

    def __str__(self):
        return self.title


class Resource(models.Model):
    """Média d'un cours : vidéo (YouTube ou fichier), PDF ou audio."""
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="resources")
    resource_type = models.CharField(max_length=10, choices=ResourceType.choices)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    # --- VIDEO ---
    video_source = models.CharField(max_length=10, choices=VideoSource.choices,
                                    default=VideoSource.UPLOAD, blank=True)
    youtube_url = models.URLField(blank=True)  # si video_source = YOUTUBE

    # --- Fichier hébergé (vidéo upload / PDF / audio) : clé jamais exposée ---
    bucket_key = models.CharField(max_length=512, blank=True)
    thumbnail_url = models.URLField(blank=True)
    thumbnail_key = models.CharField(max_length=512, blank=True)
    nb_pages = models.PositiveIntegerField(null=True, blank=True)
    duration_sec = models.PositiveIntegerField(null=True, blank=True)
    size_mo = models.FloatField(null=True, blank=True)
    audio_format = models.CharField(max_length=10, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "resources"
        ordering = ["order", "id"]

    def __str__(self):
        return self.title

    @property
    def is_youtube(self) -> bool:
        return self.resource_type == ResourceType.VIDEO and self.video_source == VideoSource.YOUTUBE


class Quiz(models.Model):
    """QCM rattaché à UN cours (débloque le suivant) OU à UNE formation (examen final).

    Un seul des deux liens est renseigné (contrainte). Les questions et options
    sont stockées en base ; la notation est faite côté serveur (RG-23 à RG-28).
    """
    course = models.OneToOneField(Course, on_delete=models.CASCADE, null=True, blank=True,
                                  related_name="quiz")
    formation = models.OneToOneField(Formation, on_delete=models.CASCADE, null=True, blank=True,
                                     related_name="final_exam")
    title = models.CharField(max_length=200, default="QCM")
    pass_threshold = models.PositiveIntegerField(default=15)  # /20 (livret §4.4)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "quizzes"
        constraints = [
            models.CheckConstraint(
                name="quiz_course_xor_formation",
                check=(
                    models.Q(course__isnull=False, formation__isnull=True)
                    | models.Q(course__isnull=True, formation__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return self.title

    @property
    def is_final(self) -> bool:
        return self.formation_id is not None


class Question(models.Model):
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="questions")
    text = models.TextField()
    # Plusieurs bonnes réponses possibles ? (sinon une seule option correcte).
    multiple = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "quiz_questions"
        ordering = ["order", "id"]

    def __str__(self):
        return self.text[:60]


class Choice(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=300)
    is_correct = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "quiz_choices"
        ordering = ["order", "id"]

    def __str__(self):
        return self.text


class QuizResult(models.Model):
    """Progression d'un membre sur un QCM (cours ou examen final) — RG-23 à RG-28."""
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="quiz_results")
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="results")
    score = models.PositiveIntegerField(default=0)        # meilleur score /20
    attempts = models.PositiveIntegerField(default=0)
    validated = models.BooleanField(default=False)
    validated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "quiz_results"
        unique_together = ("user", "quiz")

"""Fil d'actualité communautaire (CDC §4.2, RG-29 à RG-34)."""
from django.db import models


class Audience(models.TextChoices):
    TOUS = "TOUS", "Tous"
    FEMME = "FEMME", "Femme"
    ENFANT = "ENFANT", "Enfant"


class Post(models.Model):
    author = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="posts")
    text = models.TextField(max_length=2000, blank=True)       # CDC : max 2000 caractères
    image = models.ImageField(upload_to="posts/", blank=True, null=True)
    video = models.FileField(upload_to="posts/", blank=True, null=True)
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.TOUS)

    is_pinned = models.BooleanField(default=False)             # max 3 épinglés (CDC §4.2)
    is_announcement = models.BooleanField(default=False)       # communiqué admin (onglet 4)
    active = models.BooleanField(default=True)                 # suppression logique (RG-33)
    likes_count = models.PositiveIntegerField(default=0)       # cache dénormalisé (RG-29)
    shared_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="shares")  # RG-34
    created_at = models.DateTimeField(auto_now_add=True)
    scheduled_at = models.DateTimeField(null=True, blank=True)  # publication programmée

    class Meta:
        db_table = "posts"
        ordering = ["-is_pinned", "-created_at"]


class Comment(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="comments")
    text = models.TextField(max_length=2000)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "comments"
        ordering = ["created_at"]


class Like(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="likes")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="likes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "likes"
        unique_together = ("post", "user")  # like unique par membre (RG-29)


class Report(models.Model):
    """Signalement de contenu transmis à la file de modération (RG-31)."""
    class TargetType(models.TextChoices):
        POST = "POST", "Publication"
        COMMENT = "COMMENT", "Commentaire"

    reporter = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="reports")
    target_type = models.CharField(max_length=10, choices=TargetType.choices)
    target_id = models.PositiveBigIntegerField()
    reason = models.CharField(max_length=255)
    handled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "reports"
        unique_together = ("reporter", "target_type", "target_id")  # pas 2× le même

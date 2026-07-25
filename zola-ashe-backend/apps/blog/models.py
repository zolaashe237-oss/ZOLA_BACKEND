"""Blog / Journal ZOLA ASHÉ — articles éditoriaux publics."""
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class Article(models.Model):
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    excerpt = models.CharField(max_length=300, blank=True)   # chapeau / résumé
    body = models.TextField(blank=True)                       # corps (paragraphes séparés par \n)
    cover_url = models.URLField(blank=True)                   # image de couverture (publique)
    category = models.CharField(max_length=60, blank=True)
    author = models.ForeignKey("accounts.User", null=True, blank=True,
                               on_delete=models.SET_NULL, related_name="articles")
    published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-published_at", "-created_at"]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.title)[:200] or "article"
            slug, i = base, 2
            while Article.objects.exclude(pk=self.pk).filter(slug=slug).exists():
                slug = f"{base}-{i}"
                i += 1
            self.slug = slug
        if self.published and self.published_at is None:
            self.published_at = timezone.now()
        super().save(*args, **kwargs)

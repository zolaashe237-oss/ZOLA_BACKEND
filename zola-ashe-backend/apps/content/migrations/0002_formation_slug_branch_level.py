"""Ajoute slug (unique), branch et level à Formation (B01).

Stratégie :
1. AddField slug avec blank=True (pas encore unique) ;
2. RunPython : backfill du slug pour les formations existantes ;
3. AlterField : passe unique=True (toutes les lignes sont remplies) ;
4. AddField branch (default GENERALE) et level (facultatif) ;
5. AddIndex composite (branch, level) pour les filtres frontend.
"""
from django.db import migrations, models
from django.utils.text import slugify


def backfill_slugs(apps, schema_editor):
    Formation = apps.get_model("content", "Formation")
    used = set()
    for f in Formation.objects.all().order_by("id"):
        base = slugify(f.title)[:200] or f"formation-{f.id}"
        slug = base
        n = 2
        while slug in used or Formation.objects.filter(slug=slug).exclude(pk=f.pk).exists():
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        f.slug = slug
        f.save(update_fields=["slug"])


def noop_reverse(apps, schema_editor):
    """Reverse purement informatif : on ne nettoie pas les slugs au rollback."""


class Migration(migrations.Migration):
    dependencies = [("content", "0001_initial")]

    operations = [
        # 1. slug : sans unique ET sans db_index pour le backfill.
        # (SlugField a db_index=True par défaut ; on le désactive ici sinon
        # l'AlterField suivant tente de recréer l'index `_like` déjà présent.)
        migrations.AddField(
            model_name="formation",
            name="slug",
            field=models.SlugField(blank=True, max_length=220, db_index=False),
        ),
        # 2. Backfill des formations existantes.
        migrations.RunPython(backfill_slugs, noop_reverse),
        # 3. Passe unique=True maintenant que toutes les lignes ont un slug.
        # (unique=True crée à la fois l'index unique et l'index `_like`.)
        migrations.AlterField(
            model_name="formation",
            name="slug",
            field=models.SlugField(blank=True, max_length=220, unique=True),
        ),
        # 4. Branche (par défaut GENERALE : rétrocompatible).
        migrations.AddField(
            model_name="formation",
            name="branch",
            field=models.CharField(
                choices=[
                    ("GENERALE", "Générale"),
                    ("FEMME", "Branche Femme"),
                    ("ENFANT", "Branche Enfant"),
                ],
                default="GENERALE",
                max_length=10,
            ),
        ),
        # 5. Niveau (facultatif — toutes les formations n'en ont pas).
        migrations.AddField(
            model_name="formation",
            name="level",
            field=models.CharField(
                blank=True,
                choices=[
                    ("DEBUTANT", "Débutant"),
                    ("INTERMEDIAIRE", "Intermédiaire"),
                    ("AVANCE", "Avancé"),
                ],
                max_length=15,
            ),
        ),
        # 6. Index composite pour ?branch=&level=.
        migrations.AddIndex(
            model_name="formation",
            index=models.Index(fields=["branch", "level"], name="formations_branch_level_idx"),
        ),
    ]

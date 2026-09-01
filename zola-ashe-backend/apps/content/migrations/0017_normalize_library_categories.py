"""Migration de données : normalise les catégories LibraryPdf saisies manuellement.

Les livres enregistrés avant l'ajout des choix fixes peuvent avoir leur catégorie
avec une casse ou des accents différents (ex. "spiritualité", "developpement personnel").
Cette migration fait une correspondance insensible à la casse vers les valeurs canoniques.
"""
from django.db import migrations

# Correspondances insensibles à la casse vers les valeurs canoniques
_CANONICAL = {
    "spiritualité":            "Spiritualité",
    "spiritualite":            "Spiritualité",
    "développement personnel": "Développement personnel",
    "developpement personnel": "Développement personnel",
    "developpement-personnel": "Développement personnel",
    "développement-personnel": "Développement personnel",
    "entrepreneuriat":         "Entrepreneuriat",
    "création de contenu":     "Création de contenu",
    "creation de contenu":     "Création de contenu",
    "création-de-contenu":     "Création de contenu",
    "creation-de-contenu":     "Création de contenu",
}


def normalize_categories(apps, schema_editor):
    LibraryPdf = apps.get_model("content", "LibraryPdf")
    to_update = []
    for book in LibraryPdf.objects.exclude(category=""):
        canonical = _CANONICAL.get(book.category.strip().lower())
        if canonical and book.category != canonical:
            book.category = canonical
            to_update.append(book)
    if to_update:
        LibraryPdf.objects.bulk_update(to_update, ["category"])


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0016_coursecompletion"),
        ("content", "0016_librarypdf_order_category_choices"),
    ]

    operations = [
        migrations.RunPython(normalize_categories, migrations.RunPython.noop),
    ]

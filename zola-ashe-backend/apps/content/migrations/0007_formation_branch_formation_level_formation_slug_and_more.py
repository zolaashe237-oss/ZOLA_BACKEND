"""Répare le state Django pour Formation.slug/branch/level (state-only, pas de DDL).

Contexte
--------
La migration 0004 (Audio/LibraryPdf) contient un lot de `RemoveField` sur
Formation.slug/branch/level générés par makemigrations à un moment où
Django avait perdu ces fields dans le state. Résultat :
- côté DB : les colonnes ont été droppées puis re-créées par 0005 (repair
  idempotent, `ADD COLUMN IF NOT EXISTS`).
- côté state Django : les fields ont disparu après 0004 et n'ont jamais
  été réintroduits.

Cette migration réintroduit les fields **uniquement dans le state Django**
(pas de DDL). Les colonnes DB existent déjà (via 0002 ou 0005). Ainsi :
- 0008 (`rename generale to membre`) peut faire son `AlterField(branch)`
  sans lever `FieldDoesNotExist`.
- 0009 (`AddField is_public`) part d'un state cohérent.

Sur DB fraîche : 0002 crée les colonnes DDL, 0004 les drop, 0005 les
re-crée, cette migration réaligne le state → cohérence garantie.
Sur DB existante (test/prod) : même chose sans altération DB.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0006_merge_20260715_1232'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name='formation',
                    name='branch',
                    field=models.CharField(
                        choices=[
                            ('GENERALE', 'Générale'),
                            ('FEMME', 'Femmes'),
                            ('ENFANT', 'Enfants'),
                        ],
                        default='GENERALE',
                        max_length=10,
                    ),
                ),
                migrations.AddField(
                    model_name='formation',
                    name='level',
                    field=models.CharField(
                        blank=True,
                        choices=[
                            ('DEBUTANT', 'Débutant'),
                            ('INTERMEDIAIRE', 'Intermédiaire'),
                            ('AVANCE', 'Avancé'),
                        ],
                        max_length=15,
                    ),
                ),
                migrations.AddField(
                    model_name='formation',
                    name='slug',
                    field=models.SlugField(blank=True, max_length=220, unique=True),
                ),
                migrations.AddIndex(
                    model_name='formation',
                    index=models.Index(
                        fields=['branch', 'level'],
                        name='formations_branch_level_idx',
                    ),
                ),
            ],
        ),
    ]

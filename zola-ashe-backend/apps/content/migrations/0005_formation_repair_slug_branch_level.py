"""Répare `formations.slug`, `.branch`, `.level` quand 0002 les a manqués.

Contexte
--------
La migration 0002 est marquée `Applied OK` par Django mais dans certaines
DB (test, environnements récrées) les ALTER TABLE ne se sont pas exécutés
— on obtient alors `column "slug" does not exist` au premier ORM insert.
Cause probable : interaction entre `AddField(db_index=False)`, un
`RunPython(backfill)` et l'`AlterField(unique=True)` qui suit dans la
même migration.

Cette migration ne modifie PAS l'état Django (le state final est déjà bon
depuis 0002). Elle applique juste le DDL manquant côté DB, idempotent via
`IF NOT EXISTS`. Sur les DB où 0002 a fonctionné (prod), aucune ligne ne
change ; sur les DB où elle a échoué (test, éventuellement dev), les
colonnes sont ajoutées.
"""
from django.db import migrations


REPAIR_SQL = """
ALTER TABLE formations ADD COLUMN IF NOT EXISTS slug varchar(220) NOT NULL DEFAULT '';
ALTER TABLE formations ADD COLUMN IF NOT EXISTS branch varchar(10) NOT NULL DEFAULT 'GENERALE';
ALTER TABLE formations ADD COLUMN IF NOT EXISTS level varchar(15) NOT NULL DEFAULT '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'formations_slug_uniq' OR conname = 'formations_slug_8e31cc9c_uniq'
    ) THEN
        ALTER TABLE formations ADD CONSTRAINT formations_slug_uniq UNIQUE (slug);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS formations_branch_level_idx ON formations (branch, level);
"""

def apply_repair_if_postgres(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(REPAIR_SQL)
    elif schema_editor.connection.vendor == 'sqlite':
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("PRAGMA table_info(formations)")
            columns = [row[1] for row in cursor.fetchall()]
            if 'slug' not in columns:
                cursor.execute("ALTER TABLE formations ADD COLUMN slug varchar(220) NOT NULL DEFAULT ''")
            if 'branch' not in columns:
                cursor.execute("ALTER TABLE formations ADD COLUMN branch varchar(10) NOT NULL DEFAULT 'GENERALE'")
            if 'level' not in columns:
                cursor.execute("ALTER TABLE formations ADD COLUMN level varchar(15) NOT NULL DEFAULT ''")


class Migration(migrations.Migration):
    dependencies = [("content", "0004_audio_librarypdf_and_more")]

    operations = [
        migrations.RunPython(apply_repair_if_postgres, reverse_code=migrations.RunPython.noop),
    ]

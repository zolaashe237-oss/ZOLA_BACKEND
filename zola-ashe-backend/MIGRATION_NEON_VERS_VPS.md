# Migration Neon → PostgreSQL sur le VPS

Cible : conteneur `db` (postgres:18, aligné sur Neon 18.6) + `pgbouncer` déjà définis dans `docker-compose.prod.yml`.
Script : `scripts/migrate-neon-to-vps.sh` (à lancer sur le VPS). Neon n'est jamais modifié (lecture seule).

## Phase 0 — Préparation (aucun impact prod)
1. Sur le VPS, exporter l'URL **directe** Neon (sans `-pooler`) sans la laisser dans l'historique :
   `read -rs NEON_DATABASE_URL; export NEON_DATABASE_URL`
2. `./scripts/migrate-neon-to-vps.sh preflight` : versions, taille, extensions.
   - Neon est en PG 18.6, 14 Mo, extension plpgsql seule : le compose utilise donc `postgres:18` avec un volume neuf `pgdata18` (l'ancien volume `pgdata` PG15 est ignoré, non supprimé).
3. Vérifier l'espace disque (≥ 3× la taille de la base) et que `POSTGRES_USER/PASSWORD/DB` sont dans `.env`.

## Phase 1 — Répétition générale (aucun impact prod)
`CONFIRM_OVERWRITE_VPS_DB=yes ./scripts/migrate-neon-to-vps.sh copy`
→ dump + restauration + comparaison du nombre de lignes par table. Noter la durée : c'est la durée de coupure d'écriture de la phase 2.
Tester aussi : `docker compose -f docker-compose.prod.yml exec backend python manage.py migrate --check`.

## Phase 2 — Bascule (coupure d'écriture = durée du `copy`)
1. Sauvegarde de sécurité : le dump Neon de la phase 1 reste dans `backups/`.
2. Geler les écritures : `docker compose -f docker-compose.prod.yml stop celery_beat celery_worker` puis mettre le site en lecture seule/maintenance (ou arrêter `backend`).
3. `CONFIRM_OVERWRITE_VPS_DB=yes ./scripts/migrate-neon-to-vps.sh copy` (recopie finale, `verify` inclus : doit afficher OK).
4. Dans `.env` : `DATABASE_URL=postgres://${POSTGRES_USER}:<mdp>@pgbouncer:5432/${POSTGRES_DB}` et `USE_PGBOUNCER=True` (ancienne URL Neon conservée en commentaire pour le retour arrière). Vider `DATABASE_REPLICA_URL` si elle pointe vers Neon.
5. `docker compose -f docker-compose.prod.yml up -d backend celery_worker celery_beat` → contrôle `/health/`, connexion d'un compte, une lecture et une écriture.

## Retour arrière
Remettre l'ancienne `DATABASE_URL` Neon et relancer les services (Neon n'a pas été touché). Ne pas laisser Neon recevoir des écritures et le VPS aussi : après une bascule réussie, ne **jamais** relancer `copy`.

## Après la bascule
- Garder Neon intact ≥ 7 jours, puis le mettre en pause.
- Planifier `scripts/backup-db.sh` (cron quotidien) **et** copier les dumps hors du VPS ; tester une restauration.
- Le port 5432 de `db` n'est pas publié : ne pas l'exposer.

## Coupure : honnêteté
La méthode dump/restore donne une coupure d'**écriture** de quelques secondes à minutes selon la taille (lecture possible si le backend reste en ligne). Une coupure strictement nulle exige la réplication logique Neon → VPS (à activer côté Neon, + resynchronisation des séquences) ; à envisager seulement si la phase 1 montre une durée inacceptable.

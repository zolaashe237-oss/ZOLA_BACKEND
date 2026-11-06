#!/usr/bin/env bash
# Migration Neon -> PostgreSQL du VPS (conteneur `db` du docker-compose.prod.yml).
# A lancer SUR LE VPS, depuis la racine du depot (la ou se trouve docker-compose.prod.yml).
#
#   export NEON_DATABASE_URL='postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require'
#   ./scripts/migrate-neon-to-vps.sh preflight   # lecture seule : versions, extensions, taille
#   ./scripts/migrate-neon-to-vps.sh copy        # copie complete Neon -> VPS (repetable, sans impact sur la prod)
#   ./scripts/migrate-neon-to-vps.sh verify      # compare lignes par table + sequences Neon vs VPS
#
# Utiliser l'URL DIRECTE de Neon (sans "-pooler" dans le hostname) : pg_dump est incompatible
# avec le pooler. Neon n'est jamais modifie : toutes les operations sur Neon sont en lecture seule.
set -euo pipefail

: "${NEON_DATABASE_URL:?Definir NEON_DATABASE_URL (URL directe Neon, sans -pooler)}"
case "$NEON_DATABASE_URL" in *-pooler*) echo "ERREUR: URL poolee detectee, utiliser l'URL directe." >&2; exit 1;; esac
set -a; [ -f .env ] && . ./.env; set +a
: "${POSTGRES_USER:?POSTGRES_USER manquant dans .env}"; : "${POSTGRES_DB:?POSTGRES_DB manquant dans .env}"

DC="docker compose -f docker-compose.prod.yml"
PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-postgres:18}"   # client >= version serveur Neon
STAMP="$(date +%Y%m%d_%H%M%S)"; BK="backups"; mkdir -p "$BK"

neon_psql() { docker run --rm -i "$PG_CLIENT_IMAGE" psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -At "$@"; }
vps_psql()  { $DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At "$@"; }

counts_sql="select format('%I.%I', schemaname, relname) from pg_stat_user_tables order by 1"
count_rows() { # $1 = neon|vps
  local fn="${1}_psql" t
  for t in $($fn -c "$counts_sql"); do echo "$t $($fn -c "select count(*) from $t")"; done
}

preflight() {
  echo "== Neon =="; neon_psql -c "show server_version"; neon_psql -c "select pg_size_pretty(pg_database_size(current_database()))"
  echo "-- extensions:"; neon_psql -c "select extname||' '||extversion from pg_extension order by 1"
  echo "== VPS =="; vps_psql -c "show server_version"
  echo "-- extensions disponibles cote VPS requises:"
  for e in $(neon_psql -c "select extname from pg_extension where extname<>'plpgsql'"); do
    vps_psql -c "select '$e', exists(select 1 from pg_available_extensions where name='$e')"
  done
  echo "Le serveur VPS doit etre de version >= Neon (sinon passer l'image db a la meme majeure avant la copie)."
}

copy() {
  # Garde-fou : `copy` ECRASE la base du VPS. Interdit une fois la bascule faite.
  [ "${CONFIRM_OVERWRITE_VPS_DB:-}" = "yes" ] || { echo "Ecrase la base '$POSTGRES_DB' du VPS. Relancer avec CONFIRM_OVERWRITE_VPS_DB=yes (jamais apres la bascule)." >&2; exit 1; }
  echo "[1/4] Demarrage du conteneur db (seul)"; $DC up -d db
  until $DC exec -T db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; do sleep 2; done
  echo "[2/4] Dump Neon (format custom, lecture seule) -> $BK/neon_$STAMP.dump"
  docker run --rm "$PG_CLIENT_IMAGE" pg_dump "$NEON_DATABASE_URL" -Fc --no-owner --no-privileges > "$BK/neon_$STAMP.dump"
  ls -lh "$BK/neon_$STAMP.dump"
  echo "[3/4] Recreation d'une base vide sur le VPS puis restauration"
  $DC exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$POSTGRES_DB' and pid<>pg_backend_pid()" \
    -c "drop database if exists \"$POSTGRES_DB\"" -c "create database \"$POSTGRES_DB\" owner \"$POSTGRES_USER\""
  $DC exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error < "$BK/neon_$STAMP.dump"
  echo "[4/4] Verification"; verify
}

verify() {
  count_rows neon > "$BK/counts_neon_$STAMP.txt"; count_rows vps > "$BK/counts_vps_$STAMP.txt"
  if diff "$BK/counts_neon_$STAMP.txt" "$BK/counts_vps_$STAMP.txt"; then
    echo "OK: nombre de lignes identique sur $(wc -l < "$BK/counts_neon_$STAMP.txt") tables."
  else
    echo "ECART detecte (normal si Neon a ecrit depuis la copie : refaire 'copy' pendant la fenetre de bascule)." >&2; return 1
  fi
}

case "${1:-}" in preflight) preflight;; copy) copy;; verify) verify;; *) sed -n 2,12p "$0"; exit 1;; esac

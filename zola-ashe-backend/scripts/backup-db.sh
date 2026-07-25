#!/usr/bin/env bash
# Sauvegarde la base PostgreSQL via le conteneur db.
# Usage :  ./scripts/backup-db.sh   (depuis la racine du dépôt)
set -euo pipefail
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups"
mkdir -p "$OUT"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-zola}" "${POSTGRES_DB:-zola}" \
  | gzip > "$OUT/zola_${STAMP}.sql.gz"
echo "Sauvegarde écrite : $OUT/zola_${STAMP}.sql.gz"

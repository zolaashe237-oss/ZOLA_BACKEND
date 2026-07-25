# Redéploiement VPS après un `git pull`

Séquence standard à exécuter sur le VPS, dans
`/home/edwin/zolaashe/zola-ashe-backend`, quand du nouveau code est sur `main`.

---

## Commandes dans l'ordre

```bash
# 0. Backup DB avant tout changement de code
mkdir -p ~/backups && docker exec zola-ashe-backend-db-1 pg_dump -U zola zola \
  > ~/backups/backup-$(date +%Y%m%d-%H%M).sql

# 1. Pull du code
git pull --ff-only origin main

# 2. Build local (le compose prod utilise `image:`, pas `build:`)
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .

# 3. Recreate SANS re-pull (garde l'image fraîchement buildée)
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate \
  backend celery_worker celery_beat

# 4. Attendre healthy
until docker ps --filter "name=backend" --format '{{.Status}}' | grep -q healthy; do
  echo "..."; sleep 2
done

# 5. Migrer
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate

# 6. (si assets front / Swagger UI touchés)
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py collectstatic --noinput

# 7. Reload nginx si nouvelles routes
docker compose -f docker-compose.prod.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## Pièges à ne pas oublier

- **`--pull=never` obligatoire** en §3 — sinon `pull_policy: always` du compose
  écrase l'image locale par la vieille version de ghcr.
- **`--force-recreate` obligatoire** si le `.env` a changé — un simple
  `restart` ne recharge pas les variables d'environnement.
- Si `.env` inchangé et code seulement modifié : les étapes **2 → 5** suffisent.

---

## Sanity checks post-déploiement

Détails complets dans `POST_DEPLOY_CHECKS.md`. Version courte :

```bash
# Ping Gemini réel (~10 s)
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "from apps.ai_quiz.gemini_client import ping; print(ping())"

# Tarifs actifs (business critical)
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT kind, tranche_amount, price_total, is_active FROM subscription_plans ORDER BY kind;"

# Swagger UI (path custom : /api/docs/)
curl -sI https://api.zola-ashe.com/api/docs/ | head -3

# Replicas backend healthy
docker compose -f docker-compose.prod.yml ps backend
```

---

## Rollback rapide si un container ne monte pas

```bash
# Voir ce qui coince
docker compose -f docker-compose.prod.yml logs --tail=50 backend
docker compose -f docker-compose.prod.yml ps

# Repartir sur l'image ghcr (si le build local est cassé)
docker compose -f docker-compose.prod.yml pull backend celery_worker celery_beat
docker compose -f docker-compose.prod.yml up -d --force-recreate \
  backend celery_worker celery_beat
```

---

## ⚠️ Rappel avant tout redéploiement

Ne relance rien tant que le fix tarifs (`FIX_TARIFS_PROD.md`) n'est pas confirmé.
Si les 5 `SubscriptionPlan` sont encore `is_active=false`, `resolve_plan()` retombe
sur les défauts `settings.PRICE_*` et **INSCRIPTION est facturée 10 000 au lieu de 47 500**.

---

## Voir aussi

- `DEPLOY_AI_QUIZ.md` — runbook complet du déploiement initial PR #6
- `DEPLOY_TROUBLESHOOT.md` — erreurs classiques (No services to build, pgbouncer, `$` escape, 502)
- `POST_DEPLOY_CHECKS.md` — sanity checks détaillés
- `FIX_TARIFS_PROD.md` — réactiver les 5 plans
- `SETUP_CLOUDFLARE_R2.md` — brancher R2 pour le storage objet

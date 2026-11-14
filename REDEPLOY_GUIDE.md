# Guide de redéploiement backend (VPS)

---

## 0. Se placer au bon endroit

```bash
cd /home/edwin/zolaashe/zola-ashe-backend
```

---

## 1. Pull du nouveau code

```bash
# 1.1 Voir ce qui va arriver
git fetch origin
git log HEAD..origin/main --oneline
# ↑ vide = déjà à jour, rien à redéployer

# 1.2 Vérifier qu'aucun changement local ne bloque le pull
git status
# → si "nothing to commit, working tree clean" → OK
# → sinon : git stash -u  (à dépiler après le pull)

# 1.3 Pull fast-forward
git pull --ff-only origin main
```

---

## 2. Backup DB (obligatoire avant migrations)

```bash
make backup
# → crée backups/YYYY-MM-DD_HHMMSS.sql.gz
```

---

## 3. Rebuild de l'image + relance des conteneurs

```bash
# 3.1 Charger REGISTRY et TAG depuis .env
source .env

# 3.2 Calculer le sha du commit qu'on déploie (pour tag traçable)
SHA=$(git rev-parse --short HEAD)
echo "Déploiement du commit $SHA"

# 3.3 Build local avec 2 tags (:latest utilisé par compose, :sha-… pour tracer)
docker build \
  -t "${REGISTRY}/zola-ashe-backend:${TAG}" \
  -t "${REGISTRY}/zola-ashe-backend:sha-${SHA}" \
  --label "org.opencontainers.image.revision=${SHA}" \
  .

# 3.4 Recréer les 3 services sur la nouvelle image
#     --pull=never : on prend l'image locale, pas de pull réseau
docker compose -f docker-compose.prod.yml up -d \
  --pull=never --force-recreate \
  backend celery_worker celery_beat

# 3.5 Vérifier que les conteneurs tournent bien sur le commit déployé
#     (un git pull sans rebuild laisse l'ANCIEN code dans l'image)
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  $(docker compose -f docker-compose.prod.yml ps -q backend)
# → doit afficher $SHA (une ligne par réplique). Sinon : refaire 3.3 puis 3.4.
```

---

## 4. Migrations + assets

```bash
# 4.1 Appliquer les migrations (l'entrypoint prod ne le fait PAS)
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py migrate --noinput

# 4.2 Recopier les assets statiques si modifiés
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py collectstatic --noinput

# 4.3 (une seule fois) Débloquer les comptes restés RESTREINT après une
#     « inscription mensuelle » payée. Pas de --noinput : la commande ne pose
#     aucune question. Sans option = simple aperçu, rien n'est modifié.
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py repair_monthly_memberships

#     Si la liste est correcte, appliquer :
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py repair_monthly_memberships --apply
```

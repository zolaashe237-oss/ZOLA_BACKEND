# Guide de check complet du déploiement — ZOLA ASHÉ backend

Diagnostic systématique de la stack prod, couche par couche, de la plus basse
(host / Docker) à la plus haute (nginx / endpoints publics). À exécuter dans
l'ordre — chaque section suppose que les précédentes sont vertes.

Contexte : VPS `srv1705007`, dossier `/home/edwin/zolaashe/zola-ashe-backend`.

---

## 0 · Préflight — es-tu au bon endroit ?

```bash
# Tu dois voir : Dockerfile, docker-compose.prod.yml, entrypoint.sh, apps/, config/
pwd && ls
# Attendu : /home/edwin/zolaashe/zola-ashe-backend
```

**Piège** : `git pull` fait dans `/home/edwin/zolaashe/` remonte tout le
mono-repo. Le build Docker se fait dans `zola-ashe-backend/` uniquement (c'est
là qu'est le `Dockerfile`).

---

## 1 · Host & Docker — la base fonctionne ?

```bash
# Espace disque (Docker sature vite avec les images)
df -h /var/lib/docker /

# Docker daemon
docker version
docker ps -a          # tous les containers, même stoppés
docker network ls     # doit lister zola-ashe-backend_default
docker volume ls | grep -E 'zola|postgres|minio'
```

**Rouge si** :
- `df -h` < 5% dispo sur `/` → `docker system prune -f` (attention : **pas** `--volumes`)
- `docker ps -a` vide alors qu'on attend une stack → jamais démarrée ou `docker compose down` fait
- Certains containers en `Exited (X)` → §7 (logs)

---

## 2 · Images — tout est là ?

```bash
# Ce que le compose déclare
docker compose -f docker-compose.prod.yml config | grep 'image:' | sort -u

# Ce qui est réellement en local
docker images | grep -E 'zola-ashe|postgres|redis|nginx|pgbouncer|minio|certbot'
```

**Rouge si** une image du 1er listing n'est pas dans le 2e — cas classique
après `docker system prune`. Fix :

```bash
docker compose -f docker-compose.prod.yml pull db redis pgbouncer nginx certbot minio
# puis rebuild backend
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .
```

---

## 3 · Config Compose — YAML lisible ?

```bash
# Valide la syntaxe + résout les variables .env
docker compose -f docker-compose.prod.yml config > /dev/null && echo "YAML OK"

# Liste les services attendus
docker compose -f docker-compose.prod.yml config --services
# Attendu : db pgbouncer redis backend nginx celery_worker celery_beat certbot ...
```

**Rouge si** :
- Erreur `Additional property XXX is not allowed` → typo dans le YAML
- Variables tronquées : `password: foo` alors que `.env` a `foo$bar` → `$` non escapé (voir `DEPLOY_TROUBLESHOOT.md` §5, escape en `$$`)

---

## 4 · Variables `.env` — tout est renseigné ?

```bash
# Variables critiques (masquées : ne pas cat le fichier entier en clair)
grep -E '^(DEBUG|SECRET_KEY|ALLOWED_HOSTS|DATABASE_URL|REDIS_URL|GEMINI_API_KEY|GEMINI_MODEL|USE_S3|R2_)' .env | \
  sed 's/=.*/=<set>/'
```

**Rouge si** :
- `DEBUG` absent ou `=True` en prod → `DEBUG=False`
- `SECRET_KEY` par défaut / vide → régénérer
- `ALLOWED_HOSTS` sans `api.zola-ashe.com` → 400 Bad Request en HTTP
- `GEMINI_MODEL` = `gemini-2.5-flash` → 404 Google (doit être `gemini-flash-latest`)

Vérifier ce que le **conteneur** voit (pas juste le fichier hôte) :

```bash
docker compose -f docker-compose.prod.yml exec backend printenv | \
  grep -E '^(DEBUG|GEMINI|USE_S3|DATABASE_URL)' | sed 's/=.*/=<set>/'
```

Si le conteneur voit une vieille valeur : `up -d --force-recreate` obligatoire
(`restart` seul ne recharge PAS l'env).

---

## 5 · État des containers — tout est healthy ?

```bash
docker compose -f docker-compose.prod.yml ps
```

**Attendu** : chaque service en `running` + `healthy` (pour ceux qui ont un healthcheck).

**Rouge si** :
- `Restarting` en boucle → §7 (logs container)
- `unhealthy` → healthcheck échoue (souvent app pas encore prête, ou DB down)
- Un service manque → `up -d <service>`

---

## 6 · Base de données — accessible et migrée ?

### 6.1 · Connexion directe

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c "SELECT version();"
```

**Rouge si** `password authentication failed` → mismatch entre `.env` et le
hash `postgres` du volume. Ne surtout **pas** `docker volume rm` — data loss.

### 6.2 · Via pgbouncer (chemin appli)

```bash
docker exec zola-ashe-backend-pgbouncer-1 \
  psql -h 127.0.0.1 -p 6432 -U zola -d zola -c "SELECT 1;"
```

**Rouge si** `SASL error` → voir `DEPLOY_TROUBLESHOOT.md` §4 (scram-sha-256).

### 6.3 · Migrations appliquées

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py showmigrations --plan | grep -c '\[X\]'

docker compose -f docker-compose.prod.yml exec backend \
  python manage.py showmigrations | grep -E '\[ \]' && echo "MIGRATIONS EN RETARD" || echo "toutes appliquées"
```

**Rouge si** `[ ]` restants → `python manage.py migrate`

### 6.4 · Tables attendues présentes

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c "\dt" | head -50
```

**Attendu au minimum** :
- `subscription_plans`, `subscriptions`, `payments` (billing — `db_table` overridé)
- `formations`, `audio_items`, `library_pdfs` (content)
- `users`, `auth_*`, `django_migrations` (Django)

### 6.5 · Data business critical

```bash
# Tarifs — les 5 plans doivent être actifs avec bons montants
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT kind, tranche_amount, price_total, is_active FROM subscription_plans ORDER BY kind;"

# Rename GENERALE → MEMBRE bien fait
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT branch, COUNT(*) FROM formations GROUP BY branch;"
```

**Rouge si** :
- Un plan avec `is_active=false` → `FIX_TARIFS_PROD.md`
- Un `branch='GENERALE'` restant → `UPDATE formations SET branch='MEMBRE' WHERE branch='GENERALE';`

---

## 7 · Logs des containers — signal des vraies erreurs

```bash
# Vue d'ensemble récente
docker compose -f docker-compose.prod.yml logs --tail=50

# Par service
docker compose -f docker-compose.prod.yml logs --tail=100 backend
docker compose -f docker-compose.prod.yml logs --tail=100 celery_worker
docker compose -f docker-compose.prod.yml logs --tail=100 nginx
docker compose -f docker-compose.prod.yml logs --tail=100 db

# En live (Ctrl+C pour sortir)
docker compose -f docker-compose.prod.yml logs -f backend
```

**Patterns à chercher** :
- `Traceback` / `Error` / `CRITICAL` / `500`
- `OperationalError` → DB inaccessible
- `IntegrityError` / `ProgrammingError` → migration foireuse
- `ModuleNotFoundError` → dépendance manquante dans requirements.txt (rebuild nécessaire)
- `Connection refused` → un service pas encore up quand un autre tape dessus

---

## 8 · Application Django — santé interne

### 8.1 · Django check

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py check --deploy
```

**Attendu** : `System check identified no issues (0 silenced).` ou seulement des warnings SECURE_*.

### 8.2 · Django shell — imports OK

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "
from apps.billing.services import resolve_plan
from apps.content.models import Formation
from apps.ai_quiz.gemini_client import ping
print('imports OK')
print('formations:', Formation.objects.count())
print('INSCRIPTION plan:', resolve_plan('INSCRIPTION').amount, 'FCFA')
"
```

### 8.3 · Gemini réel (10 s)

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "from apps.ai_quiz.gemini_client import ping; print(ping())"
```

**Attendu** : `pong: gemini-flash-latest`

**Rouge si** :
- `403 API_KEY_INVALID` → clé révoquée sur aistudio.google.com
- `404 model not found` → mauvais `GEMINI_MODEL`
- Timeout → firewall sortant bloque

### 8.4 · Celery workers actifs

```bash
docker compose -f docker-compose.prod.yml exec backend \
  celery -A config inspect ping
```

**Attendu** : au moins une réponse `pong` par worker.

---

## 9 · Nginx & TLS — surface publique

### 9.1 · Config valide

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -t
```

**Attendu** : `syntax is ok` + `test is successful`

### 9.2 · Certificat Let's Encrypt valide

```bash
docker compose -f docker-compose.prod.yml exec nginx \
  openssl x509 -in /etc/letsencrypt/live/api.zola-ashe.com/fullchain.pem \
  -noout -dates -subject -issuer
```

**Attendu** : `notAfter=<date > aujourd'hui + 15 jours>`

### 9.3 · Reload propre (après changement de code / nouvelle route)

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## 10 · Surface publique — depuis l'extérieur

```bash
# Racine API — attendu 200 ou 401 (jamais 502)
curl -sI https://api.zola-ashe.com/api/ | head -3

# Swagger UI — path CUSTOM /api/docs/ (pas /api/schema/swagger-ui/)
curl -sI https://api.zola-ashe.com/api/docs/ | head -3

# Schéma OpenAPI (200 attendu)
curl -sI https://api.zola-ashe.com/api/schema/ | head -3

# Nouveaux endpoints IA & memoir présents dans le schéma
curl -s https://api.zola-ashe.com/api/schema/ | \
  grep -oE '"/api/admin/(quiz/generate-ai|memoir|youtube-import)[^"]*"' | sort -u
```

**Rouge si** :
- `502 Bad Gateway` → backend down ou pas encore healthy (nginx a monté avant) → `restart nginx`
- `503` → aucun backend healthy dans l'upstream
- `404` sur Swagger → path attendu = `/api/docs/`
- Timeout → firewall Cloudflare/OVH

---

## 11 · Storage & fichiers uploadés

### Si MinIO

```bash
docker compose -f docker-compose.prod.yml exec minio \
  mc ls local/zola-ashe 2>/dev/null | head
```

### Si Cloudflare R2 (USE_S3=True)

Voir `SETUP_CLOUDFLARE_R2.md` §3 (round-trip upload/read/delete).

---

## 12 · Réplicas & équilibrage (si 2 backends)

```bash
docker compose -f docker-compose.prod.yml ps backend
# doit lister backend-1 ET backend-2, tous deux "healthy"

# nginx round-robin
for i in 1 2 3 4; do
  curl -s https://api.zola-ashe.com/api/schema/ -o /dev/null -w "%{http_code}\n"
done
```

**Attendu** : 4 lignes `200`.

---

## Résumé — matrice check ↔ fix

| Symptôme | Section | Fix |
|---|---|---|
| `No such image: postgres:15` | §2 | `docker compose pull db redis …` |
| `WARN No services to build` | §2 | `docker build -t ghcr.io/…/backend:latest .` |
| `SASL error` / `scram-sha-256` | §6.2 | `DEPLOY_TROUBLESHOOT.md` §4 |
| `column XXX already exists` (migrate) | §6.3 | `SeparateDatabaseAndState` (cf. 0007) |
| INSCRIPTION facturé 10 000 | §6.5 | `FIX_TARIFS_PROD.md` |
| `GENERALE` restant en base | §6.5 | `UPDATE formations SET branch='MEMBRE' WHERE branch='GENERALE';` |
| Gemini 403/404 | §8.3 | valider clé + `GEMINI_MODEL=gemini-flash-latest` |
| 502 Bad Gateway | §7 + §10 | logs backend, attendre healthy, `restart nginx` |
| Swagger 404 | §10 | utiliser `/api/docs/` |
| Env vars pas rechargées | §4 | `up -d --force-recreate` (pas `restart`) |
| `grep.exe.stackdump` en repo | — | `find . -name '*.stackdump' -delete` + `.gitignore` |

---

## Recette express « from zero to healthy »

Quand rien ne marche et qu'on veut repartir propre **sans perdre la data** :

```bash
cd /home/edwin/zolaashe/zola-ashe-backend

# 1. Backup DB (obligatoire)
mkdir -p ~/backups && docker exec zola-ashe-backend-db-1 pg_dump -U zola zola \
  > ~/backups/backup-$(date +%Y%m%d-%H%M).sql

# 2. Stop propre (sans -v qui suppr les volumes)
docker compose -f docker-compose.prod.yml down

# 3. Pull code + images externes + rebuild backend
git pull --ff-only origin main
docker compose -f docker-compose.prod.yml pull db redis pgbouncer nginx certbot
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .

# 4. Up complet
docker compose -f docker-compose.prod.yml up -d --pull=never

# 5. Attendre + migrer + collectstatic
until docker ps --filter "name=backend" --format '{{.Status}}' | grep -q healthy; do
  echo "..."; sleep 2
done
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
docker compose -f docker-compose.prod.yml exec backend python manage.py collectstatic --noinput

# 6. Sanity checks (§6.5, §8.3, §10)
```

---

## Voir aussi

- `REDEPLOY_APRES_PULL.md` — séquence standard après pull
- `DEPLOY_TROUBLESHOOT.md` — erreurs classiques indexées
- `POST_DEPLOY_CHECKS.md` — sanity checks post-déploiement
- `FIX_TARIFS_PROD.md` — réactiver les 5 plans
- `FIX_REDEPLOY_PULL_NEVER.md` — cas `No such image: postgres:15`
- `SETUP_CLOUDFLARE_R2.md` — brancher R2 pour le storage objet

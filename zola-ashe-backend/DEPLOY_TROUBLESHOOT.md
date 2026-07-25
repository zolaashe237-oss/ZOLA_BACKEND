# Troubleshooting déploiement VPS

Piochez la section correspondant au symptôme rencontré pendant le
`DEPLOY_AI_QUIZ.md`.

---

## 1 · `WARN[0000] No services to build` en prod

**Cause racine** : le `docker-compose.prod.yml` déclare les services
`backend / celery_worker / celery_beat` avec **`image:` (pull depuis
ghcr.io), pas `build:`**. `docker compose build` n'a donc aucun service
à builder — c'est un pattern CI/CD (build ailleurs, pull sur le serveur).

**Piège** : sans CI qui push automatiquement l'image sur
`ghcr.io/edwintchakounte/zola-ashe-backend:latest` après un commit, un
`make prod-restart` (`pull && up -d`) redéploie une image obsolète.
Le §4 de `DEPLOY_AI_QUIZ.md` est **incorrect** sur ce point.

**Correctif — builder localement sur le VPS et tagger avec le nom
attendu par le compose prod** :

```bash
# 1. Backup DB AVANT tout (rename GENERALE→MEMBRE = data change)
mkdir -p ~/backups && docker exec zola-ashe-backend-db-1 pg_dump -U zola zola \
  > ~/backups/backup-avant-pr6-$(date +%Y%m%d-%H%M).sql

# 2. Build sur le VPS, tagué avec le nom que le compose attend
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .

# 3. Recreate SANS pull (garde l'image fraîchement buildée)
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate \
  backend celery_worker celery_beat

# 4. Attendre healthy
until docker ps --filter "name=backend" --format '{{.Status}}' | grep -q healthy; do
  echo "..."; sleep 2
done

# 5. Migrer
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
```

Le flag `--pull=never` est **obligatoire** : sans lui, `pull_policy: always`
du compose écrase l'image locale par la version obsolète de ghcr.

**Diag de départ (si doute sur les noms de services)** :

```bash
docker compose -f docker-compose.prod.yml config --services
# attendu: db pgbouncer redis backend nginx celery_worker celery_beat certbot ...
```

---

## 2 · `docker compose up` ne recharge pas les nouvelles variables `.env`

`restart` n'écrit pas la nouvelle env. Toujours utiliser `--force-recreate` :

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate <services>
```

Vérifier qu'une variable est bien vue par le conteneur :

```bash
docker exec <nom-backend-container> printenv | grep GEMINI
```

---

## 3 · `migrate` échoue sur `content.0007` (`column branch already exists`)

Ce cas n'arrive **PAS** avec le code de main post-PR #6 : la 0007 a été
patchée en `SeparateDatabaseAndState` (pas de DDL). Si l'erreur apparaît
malgré tout, c'est que le pull a échoué et le fichier n'a pas la bonne
version — vérifier :

```bash
head -5 apps/content/migrations/0007_formation_branch_formation_level_formation_slug_and_more.py
# doit commencer par : """Répare le state Django pour Formation.slug/branch/level (state-only, ...)"""
```

Sinon rejouer `git pull --ff-only origin main`.

---

## 4 · pgbouncer refuse la connexion (`SASL error`, `scram-sha-256`)

Piège connu (voir mémoire `zola-ashe-deploy-pitfalls`). En prod le
`pg_hba.conf` de pgbouncer doit être en `scram-sha-256` (pas `md5`) et
les mots de passe stockés dans `userlist.txt` doivent être hashés en
scram, pas en md5.

Contournement immédiat pour débloquer les migrations : bypasser pgbouncer
en faisant tourner `manage.py migrate` **directement contre la DB** (pas
via pgbouncer). Modifier temporairement `DATABASE_URL` dans le shell :

```bash
docker exec -it <nom-backend-container> bash
DATABASE_URL=postgres://zola:zola@db:5432/zola python manage.py migrate
```

---

## 5 · Escape des `$` dans `docker-compose.prod.yml`

Piège connu : Compose interprète `$` comme début de variable
d'environnement. Un mot de passe contenant `$` doit être escapé en `$$`
dans le YAML, sinon la variable est vide au runtime.

Vérifier : `docker compose -f docker-compose.prod.yml config` — cherche
si un mot de passe ou secret est tronqué au premier `$`.

---

## 6 · Nginx renvoie 502 après `up -d`

Souvent : le backend est encore en migration ou pas encore healthy quand
nginx tente le proxy. Attendre :

```bash
until docker inspect --format '{{.State.Health.Status}}' <nom-backend-container> | grep -q healthy; do
  echo "waiting..."
  sleep 2
done
```

Puis relancer nginx si besoin :

```bash
docker compose -f docker-compose.prod.yml restart nginx
```

---

## 7 · Vérifier ce qui tourne en un coup d'œil

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=30 <service>
```

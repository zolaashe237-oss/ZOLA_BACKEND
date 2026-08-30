# Déploiement backend via GHCR — 2026-08-29

Nouveau pipeline suite à la migration
`EdwinTchakounte/zolaashe` → `zolaashe237-oss/ZOLA_BACKEND`.

Le principe : à chaque `push` sur `main` qui touche `zola-ashe-backend/`,
GitHub Actions **build l'image Docker et la pousse sur GHCR**
(GitHub Container Registry). Le serveur prod ne fait plus que
`docker compose pull` + `up -d --force-recreate`.

- **Repo (nouveau)** : `zolaashe237-oss/ZOLA_BACKEND`
- **Registry cible** : `ghcr.io/zolaashe237-oss/zola-ashe-backend`
- **Tags générés** : `latest` (branche main uniquement), `main`,
  `sha-<7 premiers caractères>`, `v1.2.3` sur tag semver
- **Workflow** : `.github/workflows/build-and-push.yml`
  (à la racine du monorepo, pas dans `zola-ashe-backend/`)
- **Trigger auto** : push sur `main` touchant `zola-ashe-backend/**`
  ou le workflow lui-même, ou push d'un tag `v*`
- **Trigger manuel** : bouton **Run workflow** sur l'onglet Actions

---

## 0. Pré-requis (à faire UNE SEULE FOIS)

### 0.1 Autoriser Actions à écrire sur GHCR (org zolaashe237-oss)

Sur `https://github.com/organizations/zolaashe237-oss/settings/actions`

- **Workflow permissions** → cocher **"Read and write permissions"**
- Sauvegarder

Sans ça, le `docker/login-action` échoue avec
`denied: permission_denied: write_package`.

### 0.2 Rendre le package public (une fois la 1re image poussée)

À l'issue du 1er run réussi du workflow, GitHub crée automatiquement le
package `zola-ashe-backend` sous `zolaashe237-oss`. Rendre public pour
éviter d'avoir à `docker login` sur le VPS :

`https://github.com/orgs/zolaashe237-oss/packages` → `zola-ashe-backend`
→ **Package settings** → **Change visibility** → **Public**

> Alternative si tu préfères garder le package privé : sur le VPS
> `echo "<PAT_read:packages>" | docker login ghcr.io -u <login> --password-stdin`

### 0.3 Lier le package au repo (optionnel mais propre)

Package settings → **Manage Actions access** → ajouter le repo
`zolaashe237-oss/ZOLA_BACKEND` avec le rôle **Write**. Cela permet à
Actions de continuer à pousser même si les propriétés d'org changent.

---

## 1. Déclencher un build (dev)

**Automatique** : tout `git push origin main` qui touche
`zola-ashe-backend/**` ou `.github/workflows/build-and-push.yml`
lance le build.

**Manuel** : depuis l'onglet **Actions** du repo → workflow
"Build & Push image (backend)" → **Run workflow** (branche `main`).

Suivre l'avancement dans **Actions** puis vérifier l'image publiée :

- `https://github.com/orgs/zolaashe237-oss/packages/container/zola-ashe-backend/versions`

---

## 2. Déploiement sur le VPS prod

Une fois l'image `latest` publiée sur GHCR, sur le VPS :

```bash
cd ~/zolaashe/zola-ashe-backend

# 2.1 (une seule fois) repointer git vers le nouveau repo
git remote set-url origin https://github.com/zolaashe237-oss/ZOLA_BACKEND.git
git remote -v

# 2.2 Pull du code (docker-compose.prod.yml, entrypoint, migrations, doc)
git fetch origin
git log HEAD..origin/main --oneline    # ce qu'on va prendre
git pull --ff-only origin main

# 2.3 (une seule fois) mettre à jour .env prod : nouveau registry
#   Éditer .env et remplacer :
#     REGISTRY=ghcr.io/zolaashe237-oss
#     TAG=latest
#   NB : le compose lit ${REGISTRY:-…}, donc si tu ne changes pas le .env,
#   il utilisera le default codé dans docker-compose.prod.yml (ancien namespace).

# 2.4 Backup DB par sécurité
make backup                    # -> backups/YYYY-MM-DD_HHMMSS.sql.gz

# 2.5 Pull de la nouvelle image depuis GHCR
docker compose -f docker-compose.prod.yml pull backend worker beat

# 2.6 Recréer les conteneurs à partir de l'image fraîchement pull
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate backend worker beat

# 2.7 Migrations manuelles (l'entrypoint prod ne les applique PAS)
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py migrate --noinput

# 2.8 Collectstatic (si assets Django modifiés)
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py collectstatic --noinput

# 2.9 Redémarrer Celery (workers + beat) si des tâches async ont changé
docker compose -f docker-compose.prod.yml restart celery celery-beat
```

> `--pull=never` (étape 2.6) est **volontaire** : on vient de faire
> `docker compose pull` juste avant, `up -d` ne doit pas re-pull et
> potentiellement récupérer une autre image (cf. `FIX_REDEPLOY_PULL_NEVER.md`).

---

## 3. Smoke tests post-déploiement

```bash
# Django check
docker compose -f docker-compose.prod.yml exec backend python manage.py check

# Health
curl -fsS https://api.<domaine>/health/ && echo

# Endpoints livrés (adapter au sprint courant)
curl -fsS https://api.<domaine>/api/affiliation/ | head
curl -fsS https://api.<domaine>/api/billing/plans/ | grep -i annuel
curl -fsSI https://api.<domaine>/api/docs/ | head -1

# Logs à froid — pas d'ImportError, pas de traceback
docker compose -f docker-compose.prod.yml logs --tail=100 backend \
  | grep -Ei "error|traceback" || echo "clean"

# Version de l'image effectivement en run (comparer au sha-... publié sur GHCR)
docker compose -f docker-compose.prod.yml images backend
```

---

## 4. Rollback rapide (si le smoke test casse)

Deux stratégies au choix :

### 4.1 Repartir sur un tag SHA plus ancien

```bash
# Lister les tags disponibles sur GHCR :
#   https://github.com/orgs/zolaashe237-oss/packages/container/zola-ashe-backend/versions
# Puis dans le .env prod :

TAG=sha-<7chars_du_commit_precedent>          # remplace 'latest'

docker compose -f docker-compose.prod.yml pull backend worker beat
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate backend worker beat
```

### 4.2 Revenir au commit précédent + rebuild via workflow

```bash
# En local :
git revert <sha_cassé>
git push origin main            # déclenche un nouveau build → :latest
```

Puis relancer l'étape 2.5 → 2.9 sur le VPS.

Rollback DB (⚠️ uniquement si la migration en cause pose problème) :

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py migrate <app> <migration_precedente>
```

---

## 5. Debug workflow qui ne pousse pas

| Symptôme | Cause probable | Fix |
|---|---|---|
| `denied: permission_denied: write_package` | permission Actions read-only | Cf. §0.1 |
| `unauthorized: authentication required` côté VPS | package resté privé | Cf. §0.2 |
| Le workflow ne se déclenche pas sur un push | modif hors de `zola-ashe-backend/**` | Passer par **Run workflow** ou toucher un fichier du sous-dossier |
| Image `latest` non mise à jour | push sur une autre branche que main | `type=raw,value=latest,enable={{is_default_branch}}` : `latest` n'est posé que sur main |
| Cache Buildx qui gonfle | normal, purgé à 10 Go par `type=gha` | GitHub gère automatiquement |
| Le workflow n'existe pas dans l'onglet Actions | fichier placé dans `zola-ashe-backend/.github/…` par erreur | Il doit être à la racine du repo (monorepo) — cf. `.github/workflows/build-and-push.yml` |

---

## 6. Ce qu'il reste à faire plus tard (hors scope de cette étape)

- Ajouter un **workflow `deploy` séparé** qui SSH sur le VPS après un
  build réussi et lance les étapes 2.5 → 2.9 en auto (via
  `appleboy/ssh-action` par ex.). Nécessite les secrets `SSH_HOST`,
  `SSH_USER`, `SSH_KEY` sur le repo.
- Signer les images (`cosign`).
- Ajouter un **healthcheck** au service backend dans
  `docker-compose.prod.yml` pour qu'`up -d` sache si le rollout a réussi.
- Purger périodiquement les vieux tags `sha-...` sur GHCR (Actions
  retention ou `snok/container-retention-policy`).
- Mettre à jour le default `image:` dans `docker-compose.prod.yml`
  (`ghcr.io/edwintchakounte` → `ghcr.io/zolaashe237-oss`) pour ne plus
  dépendre du `.env` pour surcharger le namespace.
- Idem pour les docs qui pointent encore vers l'ancien namespace :
  `DEPLOY.md`, `DEPLOY_TROUBLESHOOT.md`, `REDEPLOY_APRES_PULL.md`,
  `SETUP_MINIO_PROD.md`, `SETUP_YOUTUBE_OFFICIAL_API.md`,
  `DEPLOY_MINIO_ETAPES.md`, `DEPLOY_HEALTHCHECK.md`,
  `FIX_ENV_MINIO_PROD.md`, `DEPLOY_AI_QUIZ.md`.

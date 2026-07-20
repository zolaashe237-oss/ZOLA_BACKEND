# Déploiement VPS — Sprint IA-BE + intégration Albert (PR #6)

Runbook complet pour déployer `main` après merge de la PR #6
(https://github.com/EdwinTchakounte/zolaashe/pull/6) sur le serveur prod.

> ⚠️ **Pas de CI/CD** sur ce repo (aucun `.github/workflows/`) — le
> déploiement est **manuel via SSH**. Chaque commande doit être tapée
> par toi sur le VPS. Aucun push GitHub ne redéploie automatiquement.

---

## 1 · Prérequis à préparer AVANT le SSH

- [ ] **PR #6 mergée dans `main`** sur GitHub (bouton "Merge pull request")
- [ ] **Clé Gemini** récupérée sur https://aistudio.google.com/apikey
- [ ] **YouTube Data API key** (facultatif, pour import batch admin) —
      https://console.cloud.google.com/apis
- [ ] Accès SSH VPS ok (`ssh edwin@2.24.15.184`)
- [ ] **Backup DB Postgres AVANT migration** (rename `GENERALE → MEMBRE`
      touche des vraies données) :
      ```bash
      # sur le VPS, avant tout
      docker exec zola-ashe-backend-db-1 pg_dump -U zola zola \
        > ~/backup-avant-pr6-$(date +%Y%m%d-%H%M).sql
      ```

---

## 2 · Pull du code

```bash
ssh edwin@2.24.15.184
cd /home/edwin/zolaashe
git pull --ff-only origin main
cd zola-ashe-backend
```

Vérifier le HEAD :

```bash
git log --oneline -4
# doit inclure (ordre récent → ancien) :
# d0da91a fix(backend): repair content.0007 state + adapt tests to new contracts
# 57af7ed feat(backend): memoir services/tasks/questions, admin_api finance et config
# 927c826 feat(backend): memoir, ai_quiz updates, content migrations et youtube import
# 41986db fix(cors): add custom production domains to CORS and CSRF
```

---

## 3 · Renseigner les variables dans `.env` (prod)

Ouvrir :

```bash
nano .env
```

### 3.1 CORS — déjà géré côté code

⚠️ Depuis les commits `94777e1`/`41986db` (Cabrel), les domaines prod
(`zola-ashe.com`, `www.zola-ashe.com`, `dashboard.zola-ashe.com`) et
`*.vercel.app` sont **hardcodés** dans `config/settings/base.py`. Tu peux
laisser `CORS_ALLOWED_ORIGINS` inchangé — l'union est faite automatiquement.

### 3.2 Bloc Agent IA — à vérifier / compléter

```env
# === Agent IA (Gemini) — sprint IA-BE ===
GEMINI_API_KEY=<colle ta clé aistudio.google.com/apikey>
GEMINI_MODEL=gemini-flash-latest
GEMINI_TIMEOUT_S=60
GEMINI_MAX_RETRIES=2
AI_ENABLED=True
YOUTUBE_API_KEY=<optionnel, pour import batch>
```

> ⚠️ `GEMINI_MODEL=gemini-flash-latest` — **PAS** `gemini-2.5-flash` :
> Google ne sert plus ce modèle spécifique aux nouveaux comptes.

Sauvegarder (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 4 · Build de l'image backend (~10-15 min)

L'image inclut maintenant **6 packages IA/utilitaires** :
`google-generativeai`, `pymupdf`, `youtube-transcript-api`, `python-docx`
(mémoires Word), `google-api-python-client`.

```bash
docker compose -f docker-compose.prod.yml build backend celery_worker celery_beat
```

À la fin, vérifier :

```bash
docker images | grep zola-ashe-backend-backend
# doit afficher une image "created X minutes ago"
```

---

## 5 · Recréer les conteneurs applicatifs

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate \
  backend celery_worker celery_beat
```

`--force-recreate` est **obligatoire** pour recharger `.env`
(un simple `restart` garde les anciennes variables en mémoire).

Attendre le healthy :

```bash
until docker inspect --format '{{.State.Health.Status}}' zola-ashe-backend-backend-1 | grep -q healthy; do
  sleep 2
done
echo "backend healthy"
```

---

## 6 · Migrations à appliquer

⚠️ **Rename `GENERALE → MEMBRE`** — la migration `content.0008` fait un
`UPDATE` sur les tables `formations`, `audio_items`, `library_pdfs`,
`live_sessions`, `community_channels` (chaque `branche='GENERALE'` devient
`branche='MEMBRE'`). Le backup de la §1 te couvre en cas de souci.

```bash
# Migre tout (safe : idempotent + rollback via ton backup)
docker exec zola-ashe-backend-backend-1 python manage.py migrate
```

Vérifier :

```bash
docker exec zola-ashe-backend-backend-1 python manage.py showmigrations content ai_quiz memoir billing
```

Attendu (parmi d'autres) :

```
ai_quiz
 [X] 0001_initial
 [X] 0002_aiquestion_correct_indices
 [X] 0003_rename_ai_qro_ans_verdict_idx_...

content
 [X] 0001_initial → 0004_audio_librarypdf_and_more (déjà appliquées)
 [X] 0005_resource_transcript_text        (nouveau, Albert)
 [X] 0005_formation_repair_slug_branch_level (nouveau, sprint IA-BE)
 [X] 0006_merge_20260715_1232             (nouveau, merge Django)
 [X] 0007_formation_branch_formation_level_formation_slug_and_more (fix state)
 [X] 0008_rename_generale_to_membre       (nouveau, rename branch)
 [X] 0009_formation_is_public             (nouveau)

memoir
 [X] 0001_add_editorial_status_and_notes  (nouvelle app)

billing
 [X] 0006_seed_default_plans              (nouveau, seed tarifs)
```

Vérifier le rename effectif :

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT branch, COUNT(*) FROM formations GROUP BY branch;"
# ne doit PLUS afficher 'GENERALE' — que 'MEMBRE', 'FEMME', 'ENFANT'
```

Vérifier les tarifs seedés :

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT kind, tranche_amount, price_total FROM billing_subscriptionplan WHERE is_active;"
# INSCRIPTION 47500 / COTISATION 10000 / BRANCHE_FEMME 25000 / BRANCHE_ENFANT 20000 / DON 0
```

⚠️ Si les tarifs ne correspondent PAS à ce que tu attends, désactive-les
avant qu'un membre paye au mauvais prix :
```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "UPDATE billing_subscriptionplan SET is_active=false;"
```

---

## 7 · Sanity checks (dans l'ordre)

### 7.1 Ping Gemini réel (~20 s)

```bash
docker exec zola-ashe-backend-backend-1 python manage.py shell -c \
  "from apps.ai_quiz.gemini_client import ping; print(ping())"
```

Attendu : `pong: gemini-flash-latest`

### 7.2 Tests unitaires backend (145 tests, ~2-3 min)

```bash
docker exec zola-ashe-backend-backend-1 python manage.py test --verbosity=1
```

Attendu : `Ran 145 tests ... OK`

### 7.3 CORS OK pour le dashboard

```bash
curl -i -X OPTIONS https://api.zola-ashe.com/api/auth/login/ \
  -H "Origin: https://dashboard.zola-ashe.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" 2>&1 | grep -i access-control
```

Attendu : `access-control-allow-origin: https://dashboard.zola-ashe.com`

### 7.4 Nouveaux endpoints exposés

```bash
docker exec zola-ashe-backend-backend-1 python manage.py show_urls 2>/dev/null | \
  grep -E "ai_quiz|memoir|youtube_import" | head -20
```

Doit lister au moins :
- `/api/admin/quiz/generate-ai/` (sprint IA-BE)
- `/api/admin/memoir/…` (nouveau, Albert)
- `/api/admin/youtube-import/…` (nouveau, Albert)

---

## 8 · Smoke E2E production (facultatif mais recommandé)

À faire depuis ta machine locale, avec le JWT d'un admin réel :

```bash
# 1. Login admin
ADMIN_JWT=$(curl -s -X POST https://api.zola-ashe.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin@zola.com>","password":"<mdp>"}' | jq -r .access)

# 2. Générer un quiz depuis l'Enseignement N°1 YouTube
JOB=$(curl -s -X POST https://api.zola-ashe.com/api/admin/quiz/generate-ai/ \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "module_id": <id_module_ens1>,
    "source_type": "VIDEO_YOUTUBE",
    "source_ref": "<url_youtube_ens1>",
    "nb_questions": 5,
    "ratio_qcm_qro": 0.6,
    "difficulty": "INTERMEDIAIRE"
  }' | jq -r .id)

# 3. Poller jusqu'à DONE (~30-60 s)
while true; do
  s=$(curl -s -H "Authorization: Bearer $ADMIN_JWT" \
    https://api.zola-ashe.com/api/admin/quiz/generate-ai/$JOB/ | jq -r .status)
  echo "status=$s"
  [ "$s" = "DONE" ] || [ "$s" = "FAILED" ] && break
  sleep 3
done

# 4. Lister les questions
curl -s -H "Authorization: Bearer $ADMIN_JWT" \
  https://api.zola-ashe.com/api/admin/quiz/generate-ai/$JOB/ | jq '.questions[] | {kind, text}'
```

---

## 9 · Rollback (si nécessaire)

### 9.1 Code

```bash
cd /home/edwin/zolaashe
git log --oneline -6
git reset --hard 41986db   # dernier commit avant PR #6 (Cabrel CORS)
docker compose -f docker-compose.prod.yml up -d --force-recreate \
  backend celery_worker celery_beat
```

### 9.2 Base de données (si le rename GENERALE→MEMBRE pose souci)

```bash
# option A : restore complet depuis le backup §1
docker exec -i zola-ashe-backend-db-1 psql -U zola -d zola \
  < ~/backup-avant-pr6-YYYYMMDD-HHMM.sql

# option B : reverse migrations Django (ordre inverse)
docker exec zola-ashe-backend-backend-1 python manage.py migrate memoir zero
docker exec zola-ashe-backend-backend-1 python manage.py migrate ai_quiz 0001
docker exec zola-ashe-backend-backend-1 python manage.py migrate content 0004
```

---

## 10 · Après déploiement : messages équipe

À copier/coller depuis `note.md` § 3 :

- **Garnel (FE2)** — G-03 débloqué, endpoints ai_quiz prêts
- **Cabrel (INT1)** — IA-I6 débloqué, contrat QRO documenté
- **Kevin (BE2)** — 5 endpoints ai_quiz prêts + `youtube_import` pour K-T7
- **Albert** — merge PR #6 dans main, migration 0007 réparée pour state Django

---

## Checklist "chase-list" à cocher

- [ ] Backup Postgres pris (§1)
- [ ] PR #6 mergée sur GitHub
- [ ] Clé Gemini prête
- [ ] `git pull` sur le VPS
- [ ] `.env` renseigné (bloc IA)
- [ ] `docker compose build` OK
- [ ] `docker compose up -d --force-recreate` OK, healthy
- [ ] `migrate` sans erreur (all apps)
- [ ] `\d formations` : `branch` en `MEMBRE` uniquement (plus de `GENERALE`)
- [ ] `SubscriptionPlan` tarifs corrects (47500 pour INSCRIPTION)
- [ ] Ping Gemini → `pong`
- [ ] 145/145 tests OK
- [ ] CORS OK sur dashboard
- [ ] Smoke E2E génération OK
- [ ] Messages équipe envoyés

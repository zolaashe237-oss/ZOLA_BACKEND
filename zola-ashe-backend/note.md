# NOTE — Sprint IA-BE · Livraison Edwin

Sprint SPR-ZOLA-S06-2026 · 3 → 11 juillet 2026
Bilan mi-sprint : dim/mar 8 juillet · Livraison finale : ven 11 juillet 18h00

---

## 1 · Ce qui est fait (10/10 tâches IA-B)

| # | Tâche | Livrable |
|---|---|---|
| IA-B1 | Config Gemini | `apps/ai_quiz/gemini_client.py` — `ping()`, `generate_text()`, `generate_json(schema=…)` avec retry × 2 |
| IA-B2 | Modèles + migration | 3 tables : `ai_quiz_jobs` (UUID), `ai_quiz_questions`, `ai_qro_answers` + 5 index |
| IA-B3 | Extracteur YouTube | `youtube-transcript-api`, FR → EN → traduit, 11 formats d'URL |
| IA-B4 | Extracteur PDF | PyMuPDF via `default_storage` (marche local + R2), cleaner headers/footers/contrôle, cap 200k chars |
| IA-B5 | Service prompts | 3 builders + 3 schemas JSON + 3 validateurs métier, contextualisation branche × difficulté |
| IA-B6 | Endpoint génération | `POST /api/admin/quiz/generate-ai/` — 202 + `job_id`, tâche Celery |
| IA-B7 | Endpoint statut | `GET /api/admin/quiz/generate-ai/<uuid>/` — polling avec questions nested |
| IA-B8 | Classification | Gemini pour niveau + algo déterministe pour rang parcours de la branche |
| IA-B9 | Pipeline QRO | `POST /api/quiz/<qid>/submit-qro/` — synchrone ~2-5s, fallback `NEEDS_REVIEW` si Gemini down |
| IA-B10 | File revue admin | `GET /admin/quiz/qro-review/` + `POST decide/` — idempotent |

**Code** : `apps/ai_quiz/` (13 fichiers, ~1500 lignes)
**Doc** : `apps/ai_quiz/README.md`
**Tests** : `apps/ai_quiz/tests.py` (27 tests Django) + 110 assertions pur-Python déjà vertes en local

---

## 2 · Actions restantes avant démo mardi 8

### 2.1 Fix CORS (URGENT — dashboard cassé)

Dans `/home/edwin/zolaashe/zola-ashe-backend/.env` :

```env
CORS_ALLOWED_ORIGINS=https://dashboard.zola-ashe.com,https://zola-ashe.com,https://www.zola-ashe.com
CSRF_TRUSTED_ORIGINS=https://dashboard.zola-ashe.com,https://zola-ashe.com,https://www.zola-ashe.com,https://api.zola-ashe.com
```

Puis :
```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

Vérification :
```bash
curl -i -X OPTIONS https://api.zola-ashe.com/api/auth/login/ \
  -H "Origin: https://dashboard.zola-ashe.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
# doit retourner : access-control-allow-origin: https://dashboard.zola-ashe.com
```

### 2.2 Config R2 (bloquant si uploads vidéo/PDF)

6 variables `.env` à remplacer (actuellement `CHANGEME`) :

```env
USE_S3=True
R2_BUCKET=zola-ashe
R2_ACCESS_KEY_ID=<Cloudflare R2 API Token>
R2_SECRET_ACCESS_KEY=<idem>
R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
R2_PUBLIC_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
```

Créer bucket `zola-ashe` (private) + API Token *Object Read & Write* scopé au bucket.

### 2.3 Config IA (obligatoire pour la démo)

```env
GEMINI_API_KEY=<Google AI Studio>
GEMINI_MODEL=gemini-2.5-flash
AI_ENABLED=True
YOUTUBE_API_KEY=<optionnel, pour IA-B3 real captions>
```

Clé Gemini : https://aistudio.google.com/apikey (tier gratuit couvre le sprint).

### 2.4 Chaîne de déploiement (à faire dans l'ordre)

```bash
# En local
cd /home/tchakounte/Desktop/Revolution/zolaashe
git add zola-ashe-backend/
git commit -m "feat(ai_quiz): agent Gemini complet — IA-B1→B10"
git push origin main

# Sur VPS
ssh edwin@2.24.15.184
cd /home/edwin/zolaashe && git pull --ff-only origin main
cd zola-ashe-backend
nano .env  # renseigner CORS + R2 + Gemini

docker compose -f docker-compose.prod.yml build backend celery_worker celery_beat
docker compose -f docker-compose.prod.yml up -d --force-recreate backend celery_worker celery_beat

docker exec zola-ashe-backend-backend-1 python manage.py migrate ai_quiz
docker exec zola-ashe-backend-backend-1 python manage.py test apps.ai_quiz -v 2

# Sanity check
docker exec zola-ashe-backend-backend-1 python manage.py shell -c \
  "from apps.ai_quiz.gemini_client import ping; print(ping())"
# Attendu : pong: gemini-2.5-flash
```

---

## 3 · Messages à envoyer à l'équipe

### 3.1 À Garnel (FE2) — débloqué sur G-03

> Salut Garnel, les endpoints IA sont prêts :
>
> - `POST /api/admin/quiz/generate-ai/` → renvoie `job_id` immédiatement
> - `GET /api/admin/quiz/generate-ai/<job_id>/` → poll toutes les 2s
>
> Payload et retour dans `apps/ai_quiz/README.md` § 4.1 et 4.2. Le job passe PENDING → IN_PROGRESS → DONE et retourne `suggested_level` + `suggested_rank` + les questions générées.
>
> Le badge coloré (G-04) utilise `suggested_level` (FACILE/INTERMEDIAIRE/DIFFICILE).
> La vue parcours (G-05) trie sur `suggested_rank`.

### 3.2 À Cabrel (INT1) — débloqué sur IA-I6

> Salut Cabrel, endpoints QRO côté membre + admin prêts :
>
> - `POST /api/quiz/<question_id>/submit-qro/` (membre logué) → verdict + score + justif en ~5s
> - Si Gemini down, verdict = `NEEDS_REVIEW` avec message "un correcteur va trancher" → tu affiches le bandeau IA-I8
>
> Contrats détaillés dans `README.md` § 4.3.

### 3.3 À Kevin (BE2) — pour son rapport K-T7

> Salut Kevin, tu peux tester mes 5 endpoints IA quand tu voudras :
> `POST /api/admin/quiz/generate-ai/`, `GET .../<job_id>/`, `POST /api/quiz/<qid>/submit-qro/`, `GET /api/admin/quiz/qro-review/`, `POST .../<id>/decide/`.
> Auth admin JWT sauf submit-qro qui est membre. Tests unitaires prêts si utile : `python manage.py test apps.ai_quiz`.

---

## 4 · Démo 3 min (mardi 8 juillet)

Scénario de démo IA à préparer :

1. **Login admin** au back-office → module réel visible
2. **POST generate-ai** avec `MANUAL_TEXT` (préparer un extrait de ~500 mots)
3. **Polling** live : montrer PENDING → IN_PROGRESS → DONE
4. **Résultat** : 3 QCM + 2 QRO générées, avec niveau + rang suggérés
5. **Login membre** dans un 2e onglet → répondre à une QRO
6. **Verdict IA** affiché (score + justification) en direct
7. **Retour admin** → file de revue vide (verdict = VALIDATED) OU 1 entrée si NEEDS_REVIEW

Backup si Gemini indisponible : montrer `NEEDS_REVIEW` fallback en démo.

---

## 5 · Points d'attention

- **Gemini 2.5 Flash** utilisé (le "3.5" du sprint n'existe pas côté Google) → dire simplement "version courante Flash".
- **Modèle `content.Module` non modifié** : la classification écrit dans `AIQuizJob.suggested_level/rank`. La copie vers `content.Quiz` à la publication reste à câbler (hors sprint IA-BE).
- **`resulting_quiz` sur `AIQuizJob`** reste NULL tant qu'un endpoint de publication n'est pas ajouté — c'est OK pour la démo, à prévoir dans un sprint suivant.
- **`raw_ai_output`** stocké en base pour post-mortem : consultable via Django admin `/django-admin/ai_quiz/aiquizjob/`.
- **Feature flag `AI_ENABLED=False`** coupe tous les appels si besoin (rate-limit / coûts).

---

## 6 · Autres chantiers en attente (hors sprint)

- Archiver le dossier VPS obsolète `mv /home/edwin/zola-ashe-backend-deploy /home/edwin/zola-ashe-backend-deploy.OBSOLETE`
- Mettre à jour `DEPLOY.md` avec les commandes post-up (`migrate` + `collectstatic` + `--force-recreate`)
- SSH hardening (disable root login + password auth)
- CI/CD auto-deploy workflow GitHub Actions
- Postgres backups + R2 backup push
- UptimeRobot monitoring
- Sentry integration
- Ajout `ok_fodecc.jpeg` dans "mot de l'administrateur" homepage

---

_Note rédigée en fin de chantier · à conserver comme référence pour le bilan mi-sprint._

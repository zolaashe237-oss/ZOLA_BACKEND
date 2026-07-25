# Agent IA — Génération de quiz (module `ai_quiz`)

Livraison Sprint SPR-ZOLA-S06-2026 · BE1 Edwin · 10 tâches IA-B1 → IA-B10

Le module `ai_quiz` transforme n'importe quelle source pédagogique (vidéo
YouTube, PDF, texte manuel) en un quiz éditable (QCM + QRO), puis corrige
sémantiquement les réponses ouvertes des membres via Gemini 2.5 Flash.

---

## 1 · Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Back-office admin                             │
│  Garnel FE2  ──POST /admin/quiz/generate-ai/──▶  ┌──────────────┐    │
│                                                   │  AIQuizJob    │    │
│              ◀── GET /admin/quiz/generate-ai/id ──│  PENDING      │    │
│              (polling toutes 2s)                  │  → IN_PROGRESS│    │
│                                                   │  → DONE       │    │
│                                                   └──────┬───────┘    │
└──────────────────────────────────────────────────────────┼────────────┘
                                                           │
                                                           ▼
        ┌───────────────────────────────────────────────────────────────┐
        │  Celery worker : generate_quiz_task                            │
        │                                                                │
        │  1. Extraction source                                          │
        │     ├─ VIDEO_YOUTUBE  → extract_youtube_transcript()           │
        │     ├─ PDF            → extract_pdf_text() (via default_storage)│
        │     └─ MANUAL_TEXT    → job.source_text tel quel               │
        │                                                                │
        │  2. Prompt engineering  → build_generation_prompt()            │
        │     · contextualisation branche (GENERALE/FEMME/ENFANT)        │
        │     · difficulté (FACILE/INTERMEDIAIRE/DIFFICILE)              │
        │     · JSON schema strict + garde-fous                          │
        │                                                                │
        │  3. Appel Gemini      → generate_json(schema=GENERATION_SCHEMA)│
        │     · retry × GEMINI_MAX_RETRIES (2)                           │
        │     · JSON mode natif                                          │
        │                                                                │
        │  4. Validation métier → validate_generation_output()           │
        │     · QCM : exactement 4 choix, correct_index ∈ [0,3]          │
        │     · QRO : 2-4 critères d'évaluation                          │
        │                                                                │
        │  5. Persist AIQuestion  (bulk_create, idempotent)              │
        │                                                                │
        │  6. Classification niveau + rang (IA-B8)                       │
        │     · niveau  ← Gemini (comparaison inter-modules)             │
        │     · rang    ← algorithme déterministe (peer levels)          │
        │                                                                │
        │  7. Job → DONE  (ou FAILED avec error_message)                 │
        └───────────────────────────────────────────────────────────────┘

                                    │
                                    ▼
        ┌───────────────────────────────────────────────────────────────┐
        │           Membre                            Admin              │
        │                                                                │
        │   POST /quiz/<qid>/submit-qro/       GET /admin/quiz/          │
        │   { answer_text }                        qro-review/           │
        │        │                                     │                 │
        │        ▼                                     ▼                 │
        │   generate_json(QRO_EVAL)         AIQROAnswer                  │
        │        │                          verdict=NEEDS_REVIEW         │
        │        ▼                                     │                 │
        │   AIQROAnswer                                ▼                 │
        │   verdict VALIDATED/REJECTED/       POST decide/               │
        │   NEEDS_REVIEW                      { decision, note }         │
        │                                                                │
        └───────────────────────────────────────────────────────────────┘
```

---

## 2 · Arborescence du module

```
apps/ai_quiz/
├── __init__.py
├── apps.py                       # AppConfig
├── gemini_client.py              # IA-B1 : ping(), generate_text(), generate_json()
├── models.py                     # IA-B2 : AIQuizJob, AIQuestion, AIQROAnswer
├── admin.py                      # Django admin pour debug
├── prompts.py                    # IA-B5 : builders + schemas + validateurs
├── extractors/
│   ├── __init__.py
│   ├── youtube.py                # IA-B3 : extract_youtube_transcript()
│   └── pdf.py                    # IA-B4 : extract_pdf_text() via R2
├── serializers.py                # DRF : Generation, Job, QRO, Decide
├── tasks.py                      # Celery : generate_quiz_task + classification
├── views.py                      # 5 endpoints REST
├── urls.py                       # Routes
├── migrations/0001_initial.py    # Migration écrite à la main
├── tests.py                      # ~27 tests (mocks Gemini)
└── README.md                     # Ce fichier
```

---

## 3 · Schéma de données

```
┌───────────────────────────┐        ┌──────────────────────────────┐
│  content.Module           │        │  ai_quiz_jobs (UUID PK)      │
│  (existant, non modifié)  │◀───────│  · module_id                 │
└───────────────────────────┘   FK   │  · status ∈ {PENDING,        │
                                     │              IN_PROGRESS,     │
                                     │              DONE, FAILED}    │
                                     │  · source_type ∈ {VIDEO_YT,   │
                                     │              PDF, MANUAL_TEXT}│
                                     │  · source_ref  (URL / rid)    │
                                     │  · source_text (transcription)│
                                     │  · config JSON                │
                                     │      {nb_questions,           │
                                     │       ratio_qcm_qro,          │
                                     │       difficulty}             │
                                     │  · raw_ai_output JSON         │
                                     │  · suggested_level            │
                                     │  · suggested_rank             │
                                     │  · resulting_quiz_id (Quiz)   │
                                     │  · created_by / at / finished │
                                     │  · error_message              │
                                     └────────────┬─────────────────┘
                                                  │ 1
                                                  │
                                                  ▼ n
                                     ┌──────────────────────────────┐
                                     │  ai_quiz_questions           │
                                     │  · job_id                    │
                                     │  · kind ∈ {QCM, QRO}         │
                                     │  · text                      │
                                     │  · order                     │
                                     │  · choices JSON (QCM: 4)     │
                                     │  · correct_index (QCM)       │
                                     │  · criteria JSON (QRO: 2-4)  │
                                     │  · is_published              │
                                     │  · edited_by_admin           │
                                     └────────────┬─────────────────┘
                                                  │ 1
                                                  │
                                                  ▼ n
                                     ┌──────────────────────────────┐
                                     │  ai_qro_answers              │
                                     │  · question_id (QRO only)    │
                                     │  · user_id                   │
                                     │  · answer_text               │
                                     │  · verdict ∈ {VALIDATED,     │
                                     │              REJECTED,       │
                                     │              NEEDS_REVIEW}   │
                                     │  · score /20                 │
                                     │  · justification             │
                                     │  · ai_evaluated_at           │
                                     │  · admin_decision            │
                                     │  · admin_decided_by / at     │
                                     │  · admin_note                │
                                     └──────────────────────────────┘
```

**Index créés (perfs des vues admin + polling)** :

- `ai_quiz_job_status_idx` sur `status`
- `ai_quiz_job_mod_cre_idx` sur `(module, -created_at)`
- `ai_quiz_q_job_kind_idx` sur `(job, kind)`
- `ai_qro_ans_verdict_idx` sur `verdict`
- `ai_qro_ans_user_sub_idx` sur `(user, -submitted_at)`

---

## 4 · API REST

### 4.1 Génération (admin)

**POST** `/api/admin/quiz/generate-ai/`

```json
{
  "module_id": 12,
  "source_type": "VIDEO_YOUTUBE",   // ou PDF, MANUAL_TEXT
  "source_ref": "https://www.youtube.com/watch?v=xxx",
  "source_text": "",                 // requis si source_type=MANUAL_TEXT
  "nb_questions": 5,                 // 3-20, défaut 5
  "ratio_qcm_qro": 0.6,              // 0.0-1.0, défaut 0.6
  "difficulty": "INTERMEDIAIRE"      // FACILE, INTERMEDIAIRE, DIFFICILE
}
```

**202 Accepted** → job créé, tâche Celery lancée. Utiliser `job_id` pour polling.

### 4.2 Statut (admin)

**GET** `/api/admin/quiz/generate-ai/<uuid:job_id>/`

**200 OK** — payload complet avec questions et niveau/rang si `status=DONE`.

### 4.3 Soumission QRO (membre)

**POST** `/api/quiz/<int:question_id>/submit-qro/`

```json
{ "answer_text": "Ma réponse libre." }
```

**200 OK** avec `verdict`, `score`, `justification`.
**404** si question inexistante, pas QRO ou non publiée.
**409** si l'admin a déjà tranché.

### 4.4 File de revue (admin)

**GET** `/api/admin/quiz/qro-review/?question_id=42&since=2026-07-01`

Liste paginée des réponses `NEEDS_REVIEW` non tranchées.

### 4.5 Décision admin (admin)

**POST** `/api/admin/quiz/qro-review/<int:answer_id>/decide/`

```json
{ "decision": "VALIDATED", "note": "OK malgré ambiguïté." }
```

**200 OK** avec answer mise à jour.
**409** si déjà tranchée.

---

## 5 · Contextualisation ZOLA ASHÉ

Le prompt Gemini est adapté à la branche cible :

| Branche | Ton | Impact sur les questions |
|---|---|---|
| `GENERALE` | Adulte, bienveillant, spirituel africain accessible | Vocabulaire riche |
| `FEMME` | Sororal, empathique, réalités des femmes africaines | Références culturelles ciblées |
| `ENFANT` | Chaleureux, phrases ≤ 15 mots | Éviter abstraction complexe |

Et à la difficulté :

| Difficulté | Type de questions attendues |
|---|---|
| `FACILE` | Mémorisation directe (définitions, faits explicites) |
| `INTERMEDIAIRE` | Compréhension (reformulation, liens) |
| `DIFFICILE` | Analyse, application, transfert |

---

## 6 · Garde-fous JSON

Le client Gemini utilise **JSON mode natif** (`response_mime_type=application/json`)
+ **response_schema** pour contraindre la sortie. En complément, chaque prompt
répète les règles absolues :

1. Réponds UNIQUEMENT en JSON valide, sans texte hors JSON, sans balise \`\`\`.
2. Les questions portent STRICTEMENT sur le contenu source — pas d'invention.
3. Rédige en français.
4. Pas d'opinions personnelles, pas de références à ta nature d'IA.

Post-appel, les **validateurs métier** vérifient :

- `validate_generation_output` : QCM = 4 choix, correct_index ∈ [0,3], QRO = 2-4 critères
- `validate_qro_evaluation_output` : verdict ∈ enum, score ∈ [0,20], justification non vide
- `validate_level_classification_output` : niveau ∈ enum

En cas de non-conformité → `PromptValidationError` → `generate_json` retente
jusqu'à `GEMINI_MAX_RETRIES + 1`. Si tout échoue :

- Job de génération → `FAILED` avec message clair
- Correction QRO → fallback `NEEDS_REVIEW` (file admin)

---

## 7 · Configuration

Variables `.env` requises en prod :

| Variable | Valeur type | Rôle |
|---|---|---|
| `GEMINI_API_KEY` | `AI...` (Google AI Studio) | Obligatoire |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modèle par défaut |
| `GEMINI_TIMEOUT_S` | `60` | Timeout appel |
| `GEMINI_MAX_RETRIES` | `2` | Retries JSON invalide / erreur API |
| `AI_ENABLED` | `True` | Feature flag global |
| `YOUTUBE_API_KEY` | (Console GCP → YouTube Data API v3) | Pour IA-B3 |
| `AI_LOG_LEVEL` | `INFO` | Niveau du logger `ai_quiz` |

Deps ajoutées à `requirements.txt` :

```
google-generativeai>=0.8
google-api-python-client>=2.140
youtube-transcript-api>=0.6
pymupdf>=1.24
```

---

## 8 · Sécurité & permissions

| Endpoint | Permission | Notes |
|---|---|---|
| `POST /admin/quiz/generate-ai/` | `IsAuthenticated + IsAdmin` | Admin uniquement |
| `GET /admin/quiz/generate-ai/<id>/` | `IsAuthenticated + IsAdmin` | Admin uniquement |
| `POST /quiz/<qid>/submit-qro/` | `IsAuthenticated` | Membre logué, question publiée |
| `GET /admin/quiz/qro-review/` | `IsAuthenticated + IsAdmin` | Admin uniquement |
| `POST /admin/quiz/qro-review/<id>/decide/` | `IsAuthenticated + IsAdmin` | Admin uniquement, décision irréversible |

- `AI_ENABLED=False` désactive tous les appels Gemini côté serveur (rate-limit / coûts).
- `GEMINI_API_KEY` vide → `AIConfigError` avant tout appel.
- `raw_ai_output` stocké en base pour post-mortem (JSONField).

---

## 9 · Tests

### Suite Django complète (à lancer en Docker)

```bash
docker exec zola-ashe-backend-backend-1 python manage.py test apps.ai_quiz -v 2
```

**~27 tests** répartis en 7 classes :

| Classe | Couverture |
|---|---|
| `PromptValidatorsTest` | 7 tests : happy paths + rejets |
| `YoutubeExtractorTest` | 2 tests : parsing d'URL |
| `GenerateQuizEndpointTest` | 5 tests : auth, admin, validation payload |
| `GenerationStatusEndpointTest` | 2 tests : polling + 404 |
| `SubmitQROEndpointTest` | 7 tests : auth, 404, happy, fallback Gemini down, resubmit, 409 |
| `ComputeRankTest` | 1 test : algo de rank déterministe |
| `QROReviewEndpointsTest` | 7 tests : list, filtres, decide, 409, 403, 400 |

### Smoke test standalone (déjà validé, 30 assertions)

Validateurs, contextualisation, schemas, extraction ID YouTube — voir
`_run_smoke.py` (ci-dessous § 10).

---

## 10 · Déploiement

Voir le résumé de session pour la chaîne de déploiement complète. Version courte :

```bash
# Sur le VPS (edwin@2.24.15.184)
cd /home/edwin/zolaashe && git pull --ff-only origin main
cd zola-ashe-backend

# .env : ajouter les 5 clés IA (GEMINI_API_KEY, GEMINI_MODEL, AI_ENABLED,
#         YOUTUBE_API_KEY, éventuellement AI_LOG_LEVEL)

docker compose -f docker-compose.prod.yml build backend celery_worker celery_beat
docker compose -f docker-compose.prod.yml up -d --force-recreate \
  backend celery_worker celery_beat

docker exec zola-ashe-backend-backend-1 python manage.py migrate ai_quiz
docker exec zola-ashe-backend-backend-1 python manage.py test apps.ai_quiz -v 2

# Sanity check du client
docker exec zola-ashe-backend-backend-1 python manage.py shell -c \
  "from apps.ai_quiz.gemini_client import ping; print(ping())"
# Attendu : pong: gemini-2.5-flash
```

---

## 11 · Points d'attention post-mortem

- Gemini **2.5 Flash** utilisé (le "3.5" du sprint n'existe pas côté Google). Configurable via `GEMINI_MODEL`.
- `youtube-transcript-api` privilégié à `googleapiclient.captions()` — pas d'OAuth requis.
- Extraction PDF via `default_storage.open()` → marche en local (disque) et en prod (Cloudflare R2).
- `resulting_quiz` sur `AIQuizJob` reste `NULL` — la conversion `AIQuestion → content.Question` (publication du quiz) est le workflow suivant, à câbler côté admin/back-office (hors sprint IA-BE).
- La classification (IA-B8) est **best-effort** : elle ne casse jamais la génération. Le niveau et le rang restent éditables par l'admin.

# ZOLA ASHÉ — Backend (déploiement autonome)

Dépôt **autonome** pour déployer **uniquement** le backend Django de
l'application ZOLA ASHÉ : API REST + Celery + base de données + cache +
stockage objet, exposés derrière **nginx** (TLS Let's Encrypt en prod).

Les frontends (`zola-ashe-web` membre, `zola-ashe-admin` back-office) et la
vitrine Wagtail **ne font pas partie** de ce dépôt. Ils consomment l'API
exposée ici depuis leurs propres déploiements.

---

## Sommaire

1. [Démarrage rapide](#démarrage-rapide)
2. [Composants embarqués](#composants-embarqués)
3. [Arborescence](#arborescence)
4. [Développement local](#développement-local)
5. [Endpoints exposés](#endpoints-exposés)
6. [Intégration côté frontend](#intégration-côté-frontend)
7. [Déploiement en production](#déploiement-en-production)
8. [Variables d'environnement](#variables-denvironnement)
9. [Architecture nginx](#architecture-nginx)
10. [Sauvegardes, mises à jour, rollback](#sauvegardes-mises-à-jour-rollback)
11. [Cibles `make`](#cibles-make)
12. [Dépannage](#dépannage)

---

## Démarrage rapide

```bash
cd zola-ashe-backend-deploy/
make init           # crée .env depuis .env.example
$EDITOR .env        # renseigner DJANGO_SECRET_KEY, JWT_SIGNING_KEY, CORS_ALLOWED_ORIGINS
make up             # build + démarrage en arrière-plan
make seed           # (facultatif) admin + membre démo + catalogue
make superuser      # crée un compte admin
```

Une fois la stack en route, l'API est joignable sur
**http://localhost:8000** (port configurable via `NGINX_HOST_PORT`).
Doc Swagger : **http://localhost:8000/api/docs/**.

---

## Composants embarqués

| Service        | Image                      | Rôle                                                                                  |
|----------------|----------------------------|---------------------------------------------------------------------------------------|
| `nginx`        | `nginx:1.27-alpine`        | Reverse-proxy + serveur de statiques (admin Django, Swagger UI). TLS en prod.         |
| `backend`      | construit depuis `.`       | Django 5 + DRF. Runserver en dev, Gunicorn en prod. Port `8000` **interne**.          |
| `celery_worker`| idem `backend`             | Tâches asynchrones (envoi d'OTP, traitements paiements Swinmo, etc.).                 |
| `celery_beat`  | idem `backend`             | Planificateur (rappels d'échéance d'adhésion à J-7/J-3/J-1, anti-spam, etc.).         |
| `db`           | `postgres:15`              | Base de données principale.                                                           |
| `redis`        | `redis:7-alpine`           | Cache Django + broker Celery.                                                         |
| `minio`        | `minio/minio:latest`       | Stockage objet S3-compatible **(dev)** pour les médias (vidéo/PDF/audio).             |
| `pgbouncer`    | `edoburu/pgbouncer`        | **(prod)** Pool de connexions Postgres en mode transaction.                           |
| `certbot`      | `certbot/certbot`          | **(prod)** Renouvellement automatique des certificats Let's Encrypt (boucle 12 h).    |

---

## Arborescence

```
zola-ashe-backend-deploy/
├── apps/                       # code applicatif Django (accounts, billing, content, …)
├── config/                     # settings/, urls.py, wsgi.py, celery.py
├── manage.py
├── requirements.txt
├── Dockerfile                  # image backend (build context = .)
├── entrypoint.sh               # migrate + collectstatic + seed (optionnel) + runserver/gunicorn
├── docker-compose.yml          # stack DÉV (nginx HTTP + db + redis + minio + backend + celery)
├── docker-compose.prod.yml     # stack PROD (+ TLS Let's Encrypt, pgbouncer, certbot)
├── .env.example                # toutes les variables, un seul fichier
├── Makefile                    # cibles dev (`make up`) et prod (`make prod-up`, etc.)
├── nginx/
│   ├── conf.d/default.conf            # conf nginx DÉV (HTTP)
│   ├── templates/default.conf.template # conf nginx PROD (HTTPS, envsubst sur $API_DOMAIN)
│   ├── certs/                          # certificats Let's Encrypt (git-ignoré)
│   └── acme/                           # webroot pour challenges ACME (git-ignoré)
├── pgbouncer/pgbouncer.ini     # référence (config réelle via env vars du compose)
├── scripts/backup-db.sh        # dump SQL compressé
└── README.md
```

---

## Développement local

### Prérequis

- Docker Engine 24+ et le plugin `docker compose`
- 2 Go de RAM disponibles (Postgres + Django + MinIO + Redis + Celery)
- Ports libres sur l'hôte : `8000` (nginx), `5432`, `6379`, `9000`, `9001`

### Étapes

```bash
make init                       # copie .env.example -> .env
$EDITOR .env                    # ⚠️ renseigner au minimum :
                                #   DJANGO_SECRET_KEY  (toute valeur aléatoire)
                                #   JWT_SIGNING_KEY    (toute valeur aléatoire)
                                #   CORS_ALLOWED_ORIGINS=http://localhost:3000

make up                         # build + démarrage en arrière-plan
make logs                       # suivi des logs
make ps                         # état des services

# Données de démonstration (facultatif mais recommandé pour démarrer) :
make seed                       # ajoute admin@zola.com, membre@zola.com, catalogue

# Compte admin personnalisé :
make superuser

# Arrêter :
make down                       # garde les volumes (DB persistée)
docker compose down -v          # supprime aussi les volumes (reset complet)
```

### Conflits de ports

Si un port hôte est déjà occupé sur ton poste, modifier `.env` :

```bash
NGINX_HOST_PORT=8020            # API publique
POSTGRES_HOST_PORT=5442
REDIS_HOST_PORT=6389
MINIO_HOST_PORT=9020
MINIO_CONSOLE_HOST_PORT=9021
```

Le service `backend` n'est **jamais** exposé directement à l'hôte — il
n'est joignable qu'à travers `nginx`. C'est volontaire (mimique de la prod).

---

## Endpoints exposés

Une fois `make up` lancé (et en supposant `NGINX_HOST_PORT=8000`) :

| URL                                              | Description                                                  |
|---------------------------------------------------|--------------------------------------------------------------|
| http://localhost:8000/api/                        | Racine de l'API REST                                         |
| http://localhost:8000/api/docs/                   | **Swagger UI** (doc interactive, 69 endpoints documentés)    |
| http://localhost:8000/api/redoc/                  | ReDoc (présentation alternative)                             |
| http://localhost:8000/api/schema/                 | Schéma OpenAPI 3.0 brut (YAML)                               |
| http://localhost:8000/django-admin/               | Back-office Django (superadmin)                              |
| http://localhost:9001/                            | Console MinIO (`zolaminio` / `zolaminiosecret` par défaut)   |

Endpoints fonctionnels principaux (cf. Swagger pour la liste exhaustive) :

- **Auth** : `/api/auth/register/`, `/verify-otp/`, `/login/`, `/refresh/`, `/logout/`, `/me/`
- **Compte** : `/api/me/` (GET/PUT/DELETE — DELETE = suppression RGPD anonymisée)
- **Adhésion** : `/api/subscriptions/`, `/subscriptions/close/`, `/me/payments/`
- **Paiements** : `/api/payments/initiate/`, `/api/webhooks/swinmo/`
- **Contenu** : `/api/formations/`, `/api/modules/<id>/`, `/api/courses/<id>/`, `/api/quiz/`
- **Communauté** : `/api/community/posts/`, `/community/comments/`, `/community/reports/`
- **Admin back-office** : `/api/admin/*` (formations, modules, courses, utilisateurs, paiements, audit, modération)
- **Blog** : `/api/blog/posts/`

---

## Intégration côté frontend

Le backend est conçu pour être consommé par les frontends `zola-ashe-web`
(membre) et `zola-ashe-admin` (back-office), tous deux Next.js. CORS et
cookies sont préconfigurés pour ce cas d'usage.

### Côté `.env` du backend

```bash
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://localhost:3001
WEB_BASE_URL=http://localhost:3000      # redirections paiement Swinmo
```

En prod, remplacer par les origines HTTPS réelles (ex.
`https://app.zola-ashe.com`).

### Côté frontend (exemple Next.js / fetch)

```ts
// Login : access token dans le body, refresh cookie HttpOnly automatique.
const res = await fetch("http://localhost:8000/api/auth/login/", {
  method: "POST",
  credentials: "include",                // indispensable pour le refresh cookie
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const { access } = await res.json();

// Appels authentifiés
await fetch("http://localhost:8000/api/me/", {
  headers: { Authorization: `Bearer ${access}` },
  credentials: "include",
});

// Rafraîchir le token (refresh lu dans le cookie HttpOnly par le backend)
const refresh = await fetch("http://localhost:8000/api/auth/refresh/", {
  method: "POST",
  credentials: "include",
});
```

### Flux d'authentification

1. **Inscription** (`POST /api/auth/register/`) → utilisateur créé en statut `RESTREINT`, un OTP est envoyé par email.
2. **Vérification OTP** (`POST /api/auth/verify-otp/`) → `email_verified=True`.
3. **Connexion** (`POST /api/auth/login/`) → renvoie `access` (JWT) + pose `refresh_token` en cookie HttpOnly.
4. **Inscription payée** (paiement Swinmo) → webhook valide l'adhésion → statut `ACTIF`, accès au contenu.

---

## Déploiement en production

### Prérequis serveur

- VPS ou serveur Linux avec Docker Engine + plugin `compose`
- **Domaine** pointant vers le serveur (ex. `api.zola-ashe.com`)
- **Ports 80 et 443** ouverts dans le pare-feu (TLS Let's Encrypt)
- Image backend publiée sur un registry (par défaut `ghcr.io/zola-ashe/zola-ashe-backend:latest`)
- Au moins **2 Go de RAM**, 20 Go de disque libres (DB + médias éventuels)

### Étapes

```bash
# 1. Cloner le dépôt sur le serveur
git clone <url-du-dépôt> zola-ashe-backend-deploy
cd zola-ashe-backend-deploy

# 2. Configurer .env de production
cp .env.example .env
$EDITOR .env

# Variables critiques à régler en prod :
#   DJANGO_SETTINGS_MODULE=config.settings.prod
#   DJANGO_ENV=prod
#   DEBUG=False
#   DJANGO_SECRET_KEY=<32+ caractères aléatoires>
#   JWT_SIGNING_KEY=<32+ caractères aléatoires>
#   DJANGO_ALLOWED_HOSTS=api.zola-ashe.com
#   API_DOMAIN=api.zola-ashe.com
#   ACME_EMAIL=admin@zola-ashe.com
#   DATABASE_URL=postgres://zola:<MDP>@pgbouncer:5432/zola
#   USE_PGBOUNCER=True
#   POSTGRES_USER=zola
#   POSTGRES_PASSWORD=<MDP solide>
#   USE_S3=True
#   R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
#   R2_ACCESS_KEY_ID=...
#   R2_SECRET_ACCESS_KEY=...
#   R2_BUCKET=zola-ashe
#   BREVO_SMTP_KEY=...  BREVO_API_KEY=...  DEFAULT_FROM_EMAIL=no-reply@zola-ashe.com
#   SWINMO_SECRET_KEY=sk_live_...  SWINMO_WEBHOOK_SECRET=...
#   CORS_ALLOWED_ORIGINS=https://app.zola-ashe.com
#   CSRF_TRUSTED_ORIGINS=https://app.zola-ashe.com
#   WEB_BASE_URL=https://app.zola-ashe.com
#   SEED_DEMO=False                  # ⚠️ JAMAIS True en prod

# 3. (1× seulement) Générer le certificat Let's Encrypt
#    ⚠️ Le port 80 doit être libre — aucun nginx ne doit tourner encore.
make prod-init-cert

# 4. Démarrer la stack
make prod-up
make prod-logs                       # vérifier que tout démarre proprement

# 5. Créer le superadmin et — si nécessaire — initialiser le catalogue
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

### Mises à jour

```bash
make prod-restart                    # docker compose pull && up -d (récupère la dernière image)
```

### Renouvellement TLS

Le service `certbot` tourne en boucle et renouvelle automatiquement les
certificats (vérification toutes les 12 h, renouvellement quand il reste
< 30 jours). Pour forcer un renouvellement immédiat :

```bash
make prod-renew-cert
```

---

## Variables d'environnement

Toutes les variables sont documentées dans [`.env.example`](.env.example).
Familles principales :

| Famille                | Variables                                                                              |
|------------------------|----------------------------------------------------------------------------------------|
| **Django**             | `DJANGO_SETTINGS_MODULE`, `DJANGO_SECRET_KEY`, `DEBUG`, `DJANGO_ALLOWED_HOSTS`         |
| **Base de données**    | `DATABASE_URL`, `POSTGRES_USER/PASSWORD/DB`, `USE_PGBOUNCER`                          |
| **Cache / broker**     | `REDIS_URL`                                                                            |
| **JWT**                | `JWT_SIGNING_KEY`                                                                      |
| **Stockage objet**     | `USE_S3`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`, `R2_BUCKET`  |
| **Email (Brevo)**      | `BREVO_SMTP_USER`, `BREVO_SMTP_KEY`, `BREVO_API_KEY`, `DEFAULT_FROM_EMAIL`            |
| **Paiements (Swinmo)** | `SWINMO_SECRET_KEY`, `SWINMO_WEBHOOK_SECRET`, `SWINMO_API_URL`, `SWINMO_RETURN_URL`   |
| **CORS / CSRF**        | `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `WEB_BASE_URL`                        |
| **nginx / TLS (prod)** | `ACME_EMAIL`, `API_DOMAIN`                                                             |
| **Image / scaling**    | `REGISTRY`, `TAG`, `GUNICORN_WORKERS`                                                  |
| **Ports hôte (dev)**   | `NGINX_HOST_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `MINIO_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT` |

---

## Architecture nginx

```
Client (frontend Next.js, navigateur)
    │
    │  dev  : http://localhost:8000
    │  prod : https://api.zola-ashe.com (TLS Let's Encrypt)
    ▼
┌────────────────────────────────────────────────────────────────┐
│ nginx                                                          │
│   /static/  ─────────► volume "staticfiles"  (admin + Swagger) │
│   /media/   ─────────► volume "mediafiles"   (dev sans S3)     │
│   /.well-known/acme-challenge/ → /var/www/certbot (prod)       │
│   / et /api/, /django-admin/, … → proxy_pass http://backend:8000│
│       en-têtes propagés : Host, X-Real-IP, X-Forwarded-*       │
└────────────────────────────────────────────────────────────────┘
    │
    ▼
backend (Django + DRF, Gunicorn ou runserver)
    │
    ├──► db (Postgres) — via pgbouncer en prod
    ├──► redis (cache Django + broker Celery)
    └──► minio (dev) / Cloudflare R2 (prod) — médias signés
```

En **prod**, le port `80` redirige vers `443` (sauf
`/.well-known/acme-challenge/` qui reste accessible pour les
renouvellements certbot). nginx applique HSTS, X-Content-Type-Options,
X-Frame-Options et Referrer-Policy.

---

## Sauvegardes, mises à jour, rollback

### Sauvegardes

```bash
make backup                          # dump SQL compressé -> backups/zola_<timestamp>.sql.gz
```

À planifier dans `cron` côté hôte pour des sauvegardes régulières :

```cron
0 3 * * *  cd /opt/zola-ashe-backend-deploy && make backup >> /var/log/zola-backup.log 2>&1
```

### Restauration

```bash
gunzip -c backups/zola_<timestamp>.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T db psql -U $POSTGRES_USER $POSTGRES_DB
```

### Rollback à une version précédente

```bash
TAG=v1.2.3 make prod-restart         # repointe l'image et redéploie
```

---

## Cibles `make`

```bash
make help                            # liste toutes les cibles avec leur description
```

Résumé :

| Cible              | Effet                                                            |
|--------------------|------------------------------------------------------------------|
| `make init`        | `.env.example` → `.env`                                          |
| `make up`          | Démarre la stack dev (build inclus)                              |
| `make down`        | Arrête la stack dev (volumes conservés)                          |
| `make logs`        | Suit les logs                                                    |
| `make ps`          | État des services                                                |
| `make restart`     | Redémarre proprement                                             |
| `make shell`       | Shell bash dans le conteneur backend                             |
| `make migrate`     | `python manage.py migrate`                                       |
| `make makemigrations` | `python manage.py makemigrations`                             |
| `make superuser`   | `createsuperuser`                                                |
| `make seed`        | Charge les données de démo                                       |
| `make test`        | Exécute la suite Django                                          |
| `make schema`      | Génère `schema.yaml` (OpenAPI brut)                              |
| `make collectstatic` | Force la collecte des statiques                                |
| `make prod-init-cert` | (1×) Génère le certificat Let's Encrypt initial               |
| `make prod-up`     | Démarre la stack prod                                            |
| `make prod-down`   | Arrête la stack prod                                             |
| `make prod-logs`   | Suit les logs prod                                               |
| `make prod-restart`| Pull + redémarrage prod                                          |
| `make prod-renew-cert` | Force le renouvellement TLS                                  |
| `make backup`      | Dump SQL compressé                                               |

---

## Dépannage

### `make up` échoue avec « port already in use »

Un port hôte est déjà pris. Soit arrêter l'autre service, soit changer
le port dans `.env` (voir [Conflits de ports](#conflits-de-ports)).

### `celery_beat` part en erreur « relation does not exist » au tout premier `up`

Les tables `django_celery_beat_*` ne sont pas encore créées. Devrait être
géré par le healthcheck du backend (`celery_beat` attend `service_healthy`).
Si l'erreur persiste : `docker compose restart celery_beat` une fois les
migrations terminées (vérifier avec `make logs backend`).

### Le frontend reçoit une erreur CORS

- Vérifier que l'origine du frontend est bien dans `CORS_ALLOWED_ORIGINS` dans `.env`.
- Vérifier que `credentials: "include"` est activé côté `fetch`.
- Redémarrer le backend après modification : `docker compose restart backend`.

### Statiques Django manquants (CSS admin absent)

- Vérifier que `make collectstatic` a tourné (l'`entrypoint.sh` le fait au démarrage).
- Vérifier que le volume `staticfiles` est bien partagé entre `backend` et `nginx` (`docker volume ls | grep static`).

### Le certificat Let's Encrypt ne se génère pas

- Vérifier que `API_DOMAIN` pointe bien vers le serveur (`dig $API_DOMAIN`).
- Vérifier que le port `80` est ouvert et libre **avant** `make prod-init-cert` (aucun service ne doit l'utiliser).
- Vérifier les logs : `docker compose -f docker-compose.prod.yml logs certbot`.

### Reset complet en dev

```bash
docker compose down -v               # supprime aussi pgdata, miniodata, staticfiles, mediafiles
make up
make seed                            # recharger les données de démo
```

---

## Migration depuis le monorepo

Ce dépôt embarque une **copie autonome** du code de
`mvp1_zola/zola-ashe-backend/` au moment de l'export. Pour suivre l'évolution
du backend, deux options :

- **Développer directement ici** (et faire pointer le futur monorepo vers ce dépôt) ;
- **Ré-exporter périodiquement** depuis le monorepo (`apps/`, `config/`, `manage.py`, `requirements.txt`).

Les fichiers d'infrastructure (`docker-compose*.yml`, `Makefile`, `nginx/`,
`pgbouncer/`, `scripts/`, `.env.example`, `Dockerfile`, `entrypoint.sh`) sont
**propres à ce dépôt** et ne doivent pas être réécrasés par un export du
monorepo.

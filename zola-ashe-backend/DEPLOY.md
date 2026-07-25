# DEPLOY — ZOLA ASHÉ Backend (api.zola-ashe.com)

Runbook opérationnel pour la mise en production. Pour la documentation
projet (architecture, endpoints, dev local), voir `README.md`.

---

## 1. Vue d'ensemble

```
                    Internet
                        │
                        ▼  (443)
              ┌──────────────────┐
              │  nginx (TLS LE)  │  ← certbot-init (1×) + certbot (renew 12h)
              └────────┬─────────┘
                       │ (proxy)
                       ▼
              ┌──────────────────┐
              │ backend gunicorn │  ← celery_worker × N
              └────────┬─────────┘  ← celery_beat × 1
                       │
                       ▼
              ┌──────────────────┐
              │    pgbouncer     │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐         ┌──────────┐
              │   Postgres 15    │         │ Redis 7  │
              └──────────────────┘         └──────────┘

           Objets (médias, dumps) → Cloudflare R2 (S3-compatible)
```

Aucun service exposé sur l'hôte sauf **nginx** (80 + 443). Tout le reste vit
sur le réseau Docker interne.

---

## 2. Pré-requis VPS (one-shot)

VPS Hostinger **KVM 2 minimum** (8 Go RAM, 2 vCPU, 100 Go SSD), Ubuntu
24.04 LTS. Connecté en root via le panneau Hostinger.

```bash
# Mise à jour + outils
apt update && apt upgrade -y
apt install -y curl ufw fail2ban git unattended-upgrades

# User dédié
adduser --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
# Coller la clé pub locale dans authorized_keys :
echo "ssh-ed25519 AAAA... toi@laptop" > /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

# Durcissement SSH
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall (22, 80, 443)
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# Docker officiel
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Swap 4 Go si RAM < 8 Go
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab

# Mises à jour sécurité auto
dpkg-reconfigure --priority=low unattended-upgrades
```

Activer les **snapshots hebdo** dans le panneau Hostinger.

---

## 3. DNS

Dans le registrar (zone `zola-ashe.com`) :

```
A    api    <IP_VPS>    TTL 300
```

Vérifier la propagation **avant** le 1ᵉʳ démarrage (sinon Let's Encrypt
rate-limite à 5 échecs / heure) :

```bash
dig +short api.zola-ashe.com   # doit renvoyer l'IP du VPS
```

---

## 4. Premier déploiement (1ʳᵉ mise en ligne)

### 4.1 Connexion + clonage

```bash
ssh deploy@<IP_VPS>
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/EdwinTchakounte/zola-ashe-backend-deploy.git
cd zola-ashe-backend-deploy
```

### 4.2 Configuration des secrets

```bash
cp .env.prod.example .env
nano .env   # remplacer tous les "CHANGEME" (cf. §6)
```

### 4.3 Authentification GHCR (image privée)

Créer un PAT GitHub avec scope **`read:packages`** (Settings → Developer
settings → Personal access tokens → Tokens classic).

```bash
echo "<PAT>" | docker login ghcr.io -u EdwinTchakounte --password-stdin
```

> Le `~/.docker/config.json` du user `deploy` conservera l'auth. Aucun
> autre login nécessaire ensuite.

### 4.4 Lancement

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

Observer le déroulé (§5). API en ligne sur `https://api.zola-ashe.com/api/docs/`
**après T+90 s** environ.

### 4.5 Création du superadmin (1ʳᵉ fois)

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

---

## 5. Flux auto-bootstrap TLS (premier boot)

| Temps | Acteur | Action |
|---|---|---|
| T+0   | compose | `db` → `pgbouncer` → `redis` se lancent |
| T+10  | `backend` | migrations + collectstatic, puis gunicorn |
| T+30  | healthcheck `backend` | passe `healthy` |
| T+30  | `nginx` | `00-bootstrap-tls.sh` détecte l'absence de cert → pose un **auto-signé 1 j** |
| T+30  | `nginx` | démarre, écoute 80 + 443 (warning navigateur) |
| T+30  | `certbot-init` | démarre, attend 10 s |
| T+40  | `certbot-init` | `certbot certonly --webroot -d api.zola-ashe.com` (HTTP-01) |
| T+50  | Let's Encrypt | valide le challenge → vrai cert dans `./nginx/certs/live/api.zola-ashe.com/` |
| T+90  | `nginx` | reload programmé → bascule sur le vrai cert |
| T+90+ | `certbot` | boucle de renouvellement toutes les 12 h |

**Vérifier** : `curl -I https://api.zola-ashe.com/api/schema/` doit
renvoyer `HTTP/2 200` sans `--insecure`.

Si le 1ᵉʳ boot rate (DNS pas propagé, port 80 fermé) :

```bash
docker compose -f docker-compose.prod.yml run --rm certbot-init
```

---

## 6. Variables d'environnement à remplir (`.env`)

| Variable | Comment générer / où trouver |
|---|---|
| `DJANGO_SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `JWT_SIGNING_KEY` | Idem (clé distincte) |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `DATABASE_URL` | `postgres://zola:<POSTGRES_PASSWORD>@pgbouncer:5432/zola` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → Manage R2 API Tokens |
| `R2_ENDPOINT_URL` | `https://<account-id>.r2.cloudflarestorage.com` (dashboard R2) |
| `BREVO_SMTP_USER` / `BREVO_SMTP_KEY` / `BREVO_API_KEY` | Brevo → SMTP & API |
| `SWINMO_WEBHOOK_SECRET` | Swinmo → boutique → webhooks |
| `SWINMO_SECRET_KEY` | Swinmo → API keys (Bearer `sk_live_...`) |
| `SWINMO_PRODUCT_INSCRIPTION` / `_COTISATION` / `_DON` | Swinmo → produits créés |
| `ACME_EMAIL` | Mail réel monitorée — alertes d'expiration LE |
| `SENTRY_DSN` | sentry.io → projet Django (optionnel mais recommandé) |

**Variables figées (ne PAS modifier sauf raison) :**
`DJANGO_SETTINGS_MODULE=config.settings.prod`, `DEBUG=False`,
`USE_PGBOUNCER=True`, `USE_S3=True`, `SEED_DEMO=False`,
`API_DOMAIN=api.zola-ashe.com`, `REGISTRY=ghcr.io/edwintchakounte`.

---

## 7. Opérations courantes

### Déployer une nouvelle version

CI/CD pousse une image `:latest` + `:<sha7>` sur GHCR. Sur le VPS :

```bash
cd ~/apps/zola-ashe-backend-deploy
git pull --ff-only
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker image prune -f
```

`pull_policy: always` garantit que `:latest` est rafraîchi à chaque `up -d`.

### Rollback rapide (≤ 30 s)

```bash
# Forcer un SHA spécifique (image déjà sur GHCR)
sed -i 's/^TAG=.*/TAG=abc1234/' .env
docker compose -f docker-compose.prod.yml up -d
```

> ⚠️ Le rollback ne défait PAS les migrations Django. Éviter les
> migrations destructives ; appliquer le pattern *expand → contract*.

### Lire les logs

```bash
docker compose -f docker-compose.prod.yml logs -f backend       # app
docker compose -f docker-compose.prod.yml logs -f nginx         # accès HTTP
docker compose -f docker-compose.prod.yml logs certbot-init     # 1er boot TLS
docker compose -f docker-compose.prod.yml logs --tail=200 celery_worker
```

### Redémarrer un service

```bash
docker compose -f docker-compose.prod.yml restart backend
```

### Shell Django (manage.py)

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py shell
```

### Sauvegarde Postgres (cron quotidien recommandé)

`scripts/backup-db.sh` est déjà dans le repo. Crontab :

```bash
crontab -e
# Dump quotidien 03h00 + rétention 14 j locale
0 3 * * * cd /home/deploy/apps/zola-ashe-backend-deploy && \
          ./scripts/backup-db.sh && \
          find ./backups -name "*.sql.gz" -mtime +14 -delete
```

**Pousser les dumps sur R2 trimestriellement minimum** (sinon perte
totale si le VPS crashe). À automatiser avec `aws s3 cp` ou `rclone`.

---

## 8. Dépannage

### nginx en boucle de crash au 1ᵉʳ boot
Vérifier que `00-bootstrap-tls.sh` est bien exécutable :
```bash
ls -l nginx/docker-entrypoint.d/00-bootstrap-tls.sh   # doit être -rwxr-xr-x
chmod +x nginx/docker-entrypoint.d/00-bootstrap-tls.sh
docker compose -f docker-compose.prod.yml restart nginx
```

### certbot-init échoue ("Connection refused" ou "Timeout")
Causes possibles : DNS pas propagé, port 80 bloqué (UFW, Hostinger),
nginx pas encore prêt. Vérifier :
```bash
dig +short api.zola-ashe.com
curl -I http://api.zola-ashe.com/.well-known/acme-challenge/test
```
Relancer manuellement après correction :
```bash
docker compose -f docker-compose.prod.yml run --rm certbot-init
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### Rate limit Let's Encrypt
5 échecs / heure / domaine. Si rate-limité, attendre 1 h **ou** utiliser
le staging LE en ajoutant `--server https://acme-staging-v02.api.letsencrypt.org/directory`
à `certbot-init` (cert non valide mais test du flux).

### Cert expiré
Le service `certbot` renouvelle 30 j avant expiration. Forcer :
```bash
docker compose -f docker-compose.prod.yml run --rm \
  certbot renew --webroot --webroot-path=/var/www/certbot --force-renewal
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### Erreurs pgbouncer (prepared statements, server-side cursors)
Le pooling transaction est incompatible avec ces features ; déjà
désactivées dans `config/settings/base.py` quand `USE_PGBOUNCER=True`.
Vérifier que `USE_PGBOUNCER=True` est bien dans `.env`.

### Pull GHCR refusé (`unauthorized`)
PAT expiré ou scope manquant. Recréer un PAT avec `read:packages` et
relancer `docker login ghcr.io`.

---

## 9. Checklist Go-Live

```
[ ] VPS durci (SSH key only, UFW 22/80/443, fail2ban actif)
[ ] Snapshot Hostinger hebdo activé
[ ] DNS A api.zola-ashe.com → IP VPS (propagation vérifiée)
[ ] Image ghcr.io/edwintchakounte/zola-ashe-backend:latest publiée
[ ] PAT GHCR créé + docker login OK sur le VPS
[ ] .env rempli (tous les CHANGEME remplacés)
[ ] 1er docker compose up -d : cert Let's Encrypt obtenu en < 2 min
[ ] https://api.zola-ashe.com/api/docs/ accessible (Swagger UI)
[ ] Superuser Django créé
[ ] Cron backup-db actif
[ ] UptimeRobot configuré sur /api/schema/ (5 min)
[ ] Sentry actif (DSN dans .env)
[ ] Test rollback : repasser sur le tag précédent et revenir
```

---

## 10. Architecture des secrets (qui doit avoir quoi)

| Secret | Où il vit | Qui y a accès |
|---|---|---|
| Mots de passe DB, Django/JWT keys | `~/apps/zola-ashe-backend-deploy/.env` sur le VPS | user `deploy` uniquement |
| Clés Cloudflare R2 | idem | idem |
| Clés Swinmo, Brevo | idem | idem |
| PAT GHCR `read:packages` | `~/.docker/config.json` sur le VPS | user `deploy` uniquement |
| PAT GHCR `write:packages` | **PAS sur le VPS** — uniquement GitHub Actions secrets | CI seulement |
| Clé SSH `deploy` | `~/.ssh/id_ed25519` local + GitHub Actions secret | toi + CI |

⚠️ **Le `.env` n'est PAS dans Git**. Si tu changes de serveur, tu dois le
recopier manuellement (depuis ton gestionnaire de mots de passe).

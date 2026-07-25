# Déploiement bascule MinIO sur le VPS — pas à pas

Runbook opérationnel pour appliquer les commits :

- `e012045 fix(migrations): generer les migrations manquantes (bug prod latent)`
- `b9fbf41 fix(compose): corriger tags MinIO fictifs et healthcheck impossible`
- `ddef612 docs(deploy): runbooks operationnels pour la prod backend`
- `85b9960 feat(storage): bascule les medias vers MinIO auto-heberge en prod`
- `c29894d fix(api): resoudre 500 dashboard, quiz IA et upload media`

Branche : `main` (déjà mergée + poussée sur origin).

Validé en local : 80/80 tests `apps.ai_quiz` + `apps.admin_api` OK, upload
MinIO fonctionnel, URLs signées joignables.

Voir `SETUP_MINIO_PROD.md` pour la doc de fond (architecture, pièges,
rollback). Ce fichier-ci ne donne que l'ordre exact des commandes.

---

## TL;DR — enchaînement complet (copy-paste)

Une fois **l'étape A faite** (vars MinIO ajoutées au `.env`), tout le reste
tient dans un seul bloc :

```bash
cd ~/zolaashe/zola-ashe-backend

# Code
git pull --ff-only origin main

# Build & recreate
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .
docker compose -f docker-compose.prod.yml pull \
  db redis pgbouncer nginx certbot minio minio-init
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate

# Attendre que minio-init cree le bucket
docker compose -f docker-compose.prod.yml logs minio-init --tail=20

# Migrations (CRITIQUE : sans ca les Quiz plantent en 500)
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate

# Reload nginx (nouveau prefix /zola-media/)
docker compose -f docker-compose.prod.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

# Sanity : upload test
docker compose -f docker-compose.prod.yml exec backend python -c "
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
name = default_storage.save('healthcheck.txt', ContentFile(b'ok'))
print('OK :', default_storage.url(name))
default_storage.delete(name)
"
```

Si le `print('OK : https://api.zola-ashe.com/zola-media/...')` s'affiche → tout
va bien, tester ensuite dashboard/quiz/upload contenu dans l'admin.

Détails, edge cases et rollback ci-dessous.

---

## Étape A · Préparer le `.env` (avant tout redémarrage)

```bash
cd ~/zolaashe/zola-ashe-backend

# Sauvegarder l'.env actuel au cas où
cp .env .env.bak.$(date +%Y%m%d-%H%M)

# Générer les credentials MinIO (root)
echo "R2_ACCESS_KEY_ID=$(openssl rand -hex 16)"
echo "R2_SECRET_ACCESS_KEY=$(openssl rand -hex 24)"
```

Puis éditer `.env` (`nano .env`) et **ajouter / remplacer** :

```bash
USE_S3=True
MEDIA_BUCKET=zola-media
R2_ACCESS_KEY_ID=<valeur générée ci-dessus>
R2_SECRET_ACCESS_KEY=<valeur générée ci-dessus>
R2_BUCKET=zola-media
R2_ENDPOINT_URL=http://minio:9000
R2_PUBLIC_ENDPOINT_URL=https://api.zola-ashe.com
AWS_S3_ADDRESSING_STYLE=path
AWS_S3_REGION_NAME=us-east-1
```

⚠️ `R2_BUCKET` doit être **identique** à `MEDIA_BUCKET` (sinon nginx route
sur un mauvais bucket).

⚠️ `R2_PUBLIC_ENDPOINT_URL` = `https://<domain>` **sans suffixe** (pas de
`/s3`). Le bucket sert de prefix : boto3 générera
`https://api.zola-ashe.com/zola-media/<key>?X-Amz-Signature=…`.

---

## Étape B · Récupérer le code

```bash
# Sur quelle branche le VPS tourne-t-il ?
git branch --show-current
```

**Si sur `main`** : merger d'abord la feature branch.

```bash
git fetch origin
git merge origin/feature/albert-backend-integration-fixes --no-edit
```

**Si déjà sur `feature/albert-backend-integration-fixes`** :

```bash
git pull --ff-only origin feature/albert-backend-integration-fixes
```

---

## Étape C · Redéployer

```bash
# 1. Rebuild backend (nouveau code Python : storages.py + fixes 500)
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .

# 2. Pre-pull des images externes (sinon --pull=never coincera sur minio/mc)
docker compose -f docker-compose.prod.yml pull \
  db redis pgbouncer nginx certbot minio minio-init

# 3. Recreate stack (nouveaux services minio + minio-init)
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate

# 4. Suivre minio-init (doit finir en "bucket zola-media prêt.")
docker compose -f docker-compose.prod.yml logs -f minio-init
# Ctrl-C dès qu'il affiche "bucket zola-media prêt."

# 5. Appliquer les 4 migrations manquantes (bug prod latent detecte en test local)
#    Sans ca : ProgrammingError "column library_pdf_id ... does not exist" a la
#    creation de toute instance Quiz. Voir commit e012045.
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
# Attendu : 4 lignes "Applying accounts.0003_globalsettings... OK" + ...
```

---

## Étape D · Recharger nginx

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## Étape E · Sanity checks (dans l'ordre)

### E1 · Upload test depuis Django

```bash
docker compose -f docker-compose.prod.yml exec backend python -c "
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
name = default_storage.save('healthcheck.txt', ContentFile(b'ok'))
print('upload OK :', name)
print('URL signee:', default_storage.url(name))
"
```

Attendu : `upload OK : healthcheck.txt` (ou variante avec suffixe) et une
URL signée `https://api.zola-ashe.com/zola-media/…?X-Amz-Signature=…`.

### E2 · Vérifier que l'URL signée est accessible depuis dehors

Copier l'URL retournée et :

```bash
curl -sI '<URL_signée_ici>' | head -5
```

Attendu : `HTTP/2 200` + `Content-Type: text/plain`.

En cas de `403 SignatureDoesNotMatch` → voir §6 pièges de
`SETUP_MINIO_PROD.md` (souvent : mauvais `Host` dans nginx ou
`R2_PUBLIC_ENDPOINT_URL` incorrect).

### E3 · Cleanup du fichier test

```bash
docker compose -f docker-compose.prod.yml exec backend python -c "
from django.core.files.storage import default_storage
default_storage.delete('healthcheck.txt')
print('delete OK')
"
```

### E4 · Dashboard admin (fix 500 dashboard)

- Se connecter à `https://api.zola-ashe.com/django-admin/`
- Charger `https://api.zola-ashe.com/api/admin/dashboard/`
- Attendu : temps de réponse < 1 s, code `200`

### E5 · Quiz IA (fix 500 quiz)

- Générer un quiz via `https://api.zola-ashe.com/api/admin/quiz/generate-ai/`
- Vérifier qu'aucun 500 n'apparaît, que le job passe en `SUCCEEDED`
- Soumettre une réponse — le grading QRO doit renvoyer un verdict
  (`OK`, `KO`, ou `NEEDS_REVIEW`), plus jamais de 500

### E6 · Upload de contenu avec pièce jointe

- Créer un cours via l'admin en attachant un PDF
- Vérifier que le fichier est bien uploadé (pas de 500)
- Rafraîchir la page — l'aperçu doit s'afficher (URL signée MinIO)
- Répéter 2-3 fois pour valider les 2 replicas backend (avant : 1/2 en 404,
  maintenant tout doit passer)

---

## Étape F · Migration des uploads existants

Si le volume `media:` (ancien stockage local) contient déjà des fichiers,
il faut les copier vers MinIO **avant** de supprimer le volume.

### F1 · Vérifier ce qu'il y a dans l'ancien volume

```bash
docker run --rm -v zola-ashe-backend_media:/src alpine sh -c \
  "ls -R /src 2>/dev/null | head -20; du -sh /src"
```

- Si **vide** (juste `4K` de dossier) → sauter directement à F3.
- Si **non vide** → passer à F2.

### F2 · Migrer via `mc mirror`

⚠️ Adapter le nom du **réseau** et du **volume** Docker (varie selon le
préfixe du projet). Vérifier avec `docker network ls` et
`docker volume ls`.

```bash
# Charger les creds MinIO depuis le .env pour cette session shell
export $(grep -E '^R2_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)=' .env | xargs)

docker run --rm --network zola-ashe-backend_default \
  -v zola-ashe-backend_media:/src \
  minio/mc:RELEASE.2025-01-17T23-25-50Z \
  sh -c "mc alias set local http://minio:9000 $R2_ACCESS_KEY_ID $R2_SECRET_ACCESS_KEY && mc mirror --overwrite /src local/zola-media/"
```

Vérifier :

```bash
docker compose -f docker-compose.prod.yml exec minio sh -c \
  'mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc ls -r local/zola-media/ | head -20'
```

### F3 · Supprimer l'ancien volume (après validation)

⚠️ Ne le faire **QUE** si F2 a bien été validé (`mc ls` liste bien les
fichiers) et que l'app fonctionne (URLs signées OK).

```bash
docker volume rm zola-ashe-backend_media
```

---

## En cas de problème

### Rollback rapide

Repasser sur l'ancien code sans MinIO :

```bash
# Repasser USE_S3=False dans .env
sed -i 's/^USE_S3=True/USE_S3=False/' .env

# Revenir au commit précédent
git log --oneline -6
git checkout <hash_avant_MinIO>

# Redeploy
docker compose -f docker-compose.prod.yml up -d --force-recreate \
  backend celery_worker celery_beat nginx
```

Les fichiers restent dans `miniodata:` (rien n'est perdu). Une seconde
tentative reprendra le bucket tel quel.

### Symptômes courants

| Symptôme | Cause probable | Fix |
|---|---|---|
| `NoSuchBucket` au 1er upload | `minio-init` a échoué | `docker compose logs minio-init` puis `docker compose up -d --force-recreate minio-init` |
| `403 SignatureDoesNotMatch` sur GET | `R2_PUBLIC_ENDPOINT_URL` mal configuré ou nginx strip le prefix | Vérifier `.env` + `nginx/templates/default.conf.template` (pas de trailing slash dans `proxy_pass`) |
| Upload timeout | `client_max_body_size` nginx trop bas | Déjà à `512M` dans le template — vérifier `nginx -T` |
| 502 sur `/zola-media/…` | Service `minio` down | `docker compose ps minio` + `docker compose logs minio` |

---

## Cross-refs

- Architecture MinIO complète → `SETUP_MINIO_PROD.md`
- Redéploiement standard (sans MinIO) → `REDEPLOY_APRES_PULL.md`
- Diagnostic 12 couches → `DEPLOY_HEALTHCHECK.md`
- Pièges `--pull=never` → `FIX_REDEPLOY_PULL_NEVER.md`
- Tarifs à réactiver (pending) → `FIX_TARIFS_PROD.md`

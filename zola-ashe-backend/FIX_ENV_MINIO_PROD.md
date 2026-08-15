# Fix — `.env` prod pointe encore sur R2 par défaut (Étape A oubliée)

## Symptôme

Le sanity check E1 échoue avec :

```
botocore.exceptions.SSLError: SSL validation failed for
https://CHANGEME.r2.cloudflarestorage.com/zola-ashe/healthcheck.txt
```

## Diagnostic

- `CHANGEME.r2.cloudflarestorage.com` = valeur fallback dans
  `config/settings/base.py` quand `R2_ENDPOINT_URL` n'est **pas** défini
  dans `.env`.
- Bucket `zola-ashe` = ancien nom par défaut, pas `zola-media`.
- Conclusion : **l'Étape A du runbook n'a pas été appliquée** avant le
  redémarrage. Le stack tourne, MinIO tourne, mais Django ignore MinIO
  parce qu'il ne voit pas les variables d'environnement MinIO.

## Cause secondaire

Le service `minio` a démarré une **première fois** avec des credentials
par défaut (`minioadmin/minioadmin` ou celles présentes au boot). Ces
credentials sont **gravées définitivement** dans le volume `miniodata`
au 1er boot — impossible de les changer sans détruire le volume.

Donc même si on ajoute `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` au
`.env` maintenant, MinIO les refusera car il attend les originales.

## Fix — pas à pas

### 1. Renseigner `.env` avec les vrais paramètres MinIO

```bash
cd /home/edwin/zolaashe/zola-ashe-backend

# Backup
cp .env .env.bak.$(date +%Y%m%d-%H%M)

# Générer les creds MinIO (root)
echo "R2_ACCESS_KEY_ID=$(openssl rand -hex 16)"
echo "R2_SECRET_ACCESS_KEY=$(openssl rand -hex 24)"
```

Noter les 2 valeurs, puis :

```bash
nano .env
```

**Ajouter / remplacer** ce bloc :

```
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

### 2. Détruire le volume MinIO (creds erronées gravées au 1er boot)

⚠️ Le bucket est vide (rien d'uploadé encore) — aucune donnée à perdre.

```bash
docker compose -f docker-compose.prod.yml stop minio minio-init
docker compose -f docker-compose.prod.yml rm -f minio minio-init
docker volume rm zola-ashe-backend_miniodata
```

### 3. Recréer MinIO avec les bonnes creds

```bash
docker compose -f docker-compose.prod.yml up -d minio minio-init

# Vérifier que le bucket est recréé avec les nouvelles creds
docker compose -f docker-compose.prod.yml logs minio-init --tail=15
```

Attendu :
```
[minio-init] MinIO prêt.
Added `local` successfully.
Bucket created successfully `local/zola-media`.
[minio-init] bucket zola-media prêt.
```

### 4. Recréer backend + celery (relire le `.env`)

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate \
  backend celery_worker celery_beat
```

### 5. Retester

```bash
docker compose -f docker-compose.prod.yml exec backend python -c "
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
name = default_storage.save('healthcheck.txt', ContentFile(b'ok'))
print('OK :', default_storage.url(name))
default_storage.delete(name)
"
```

**Attendu** :
```
OK : https://api.zola-ashe.com/zola-media/healthcheck.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&...
```

Si l'URL contient `zola-media/` et `api.zola-ashe.com` → fix réussi.

### 6. Vérifier que l'URL signée est joignable depuis dehors

```bash
# Recopier l'URL exacte affichée par le sanity check
curl -sI '<URL_signée_ci-dessus>' | head -5
```

Attendu : `HTTP/2 200`.

Si `403 SignatureDoesNotMatch` → nginx strip le prefix bucket. Vérifier
`nginx/templates/default.conf.template` : `proxy_pass http://minio:9000;`
**sans slash final**.

## Après ce fix

Reprendre le runbook standard [`DEPLOY_MINIO_ETAPES.md`](DEPLOY_MINIO_ETAPES.md)
à partir de l'**étape E3** (cleanup) puis E4/E5/E6 (dashboard, quiz IA,
upload contenu).

## Comment éviter cette erreur à l'avenir

Le runbook `DEPLOY_MINIO_ETAPES.md` place l'Étape A **en tout premier**
justement pour cette raison. Le TL;DR copy-paste au début du runbook
commence explicitement par :

> Une fois **l'étape A faite** (vars MinIO ajoutées au `.env`), tout le
> reste tient dans un seul bloc

→ **ne jamais** exécuter le bloc TL;DR sans avoir fait l'Étape A avant.

---

## Piège 2 — `force-recreate` échoue silencieusement (registry denied)

### Symptôme

Après avoir édité le `.env`, on relance :

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate \
  backend celery_worker celery_beat
```

Et on obtient :

```
[+] up 1/1
 ! Image ghcr.io/edwintchakounte/zola-ashe-backend:latest Interrupted   0.6s
Error response from daemon: error from registry: denied
```

**Résultat : le backend n'a jamais redémarré.** Il tourne toujours avec
l'ancien `.env` en mémoire → l'erreur `SSL validation failed for
https://CHANGEME.r2.cloudflarestorage.com/…` continue exactement comme
avant, ce qui est trompeur (on croit que le fix n'a pas marché).

### Cause

`docker compose up` tente de **pull** l'image `ghcr.io/…` avant de
recréer les conteneurs. L'image existe bien en local (elle vient de
`docker build`), mais GHCR répond `denied` car le tag `:latest` n'y est
pas publié (ou pas de credentials).

### Fix

Ajouter `--pull=never` pour dire à Compose « utilise l'image locale, ne
va pas au registry » :

```bash
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate \
  backend celery_worker celery_beat
```

C'est la même logique que le TL;DR du runbook principal, qui utilise
déjà `--pull=never` pour tous les `up`.

---

## Checklist de vérification (dans l'ordre)

Après avoir édité `.env` **et** avant de retester le sanity check E1,
exécuter ces 4 checks :

### 1. Le `.env` contient bien les 9 vars MinIO

```bash
cd /home/edwin/zolaashe/zola-ashe-backend

grep -E '^(USE_S3|MEDIA_BUCKET|R2_ENDPOINT_URL|R2_PUBLIC_ENDPOINT_URL|R2_BUCKET|AWS_S3_ADDRESSING_STYLE|AWS_S3_REGION_NAME)=' .env
grep -cE '^R2_ACCESS_KEY_ID=' .env
grep -cE '^R2_SECRET_ACCESS_KEY=' .env
```

Attendu :

- 7 lignes affichées :
  ```
  USE_S3=True
  MEDIA_BUCKET=zola-media
  R2_ENDPOINT_URL=http://minio:9000
  R2_PUBLIC_ENDPOINT_URL=https://api.zola-ashe.com
  R2_BUCKET=zola-media
  AWS_S3_ADDRESSING_STYLE=path
  AWS_S3_REGION_NAME=us-east-1
  ```
- Puis `1` puis `1` (les 2 secrets présents chacun une fois).

**Si un check échoue → `nano .env` et corriger avant de continuer.** Ne
pas afficher les secrets à l'écran, se contenter du `grep -c` qui
compte les lignes.

### 2. `minio-init` a bien créé le bucket

```bash
docker compose -f docker-compose.prod.yml logs minio-init --tail=20
```

Doit afficher :

```
[minio-init] MinIO prêt.
Added `local` successfully.
Bucket created successfully `local/zola-media`.
[minio-init] bucket zola-media prêt.
```

Si on ne voit que `attente de MinIO...` sans suite → attendre 30 s de
plus et relancer la commande. Si toujours pas → voir §Symptômes courants
de `DEPLOY_MINIO_ETAPES.md`.

### 3. Recréer backend + celery avec `--pull=never`

```bash
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate \
  backend celery_worker celery_beat
```

Attendu : 4 conteneurs `Started` (2 backend, 2 celery), pas de `denied`.

### 4. Vérifier que le backend lit bien les nouvelles vars

```bash
docker compose -f docker-compose.prod.yml exec backend env \
  | grep -E '^(R2_|USE_S3|MEDIA_BUCKET|AWS_S3)' \
  | sort
```

Attendu — au minimum ces lignes :

```
AWS_S3_ADDRESSING_STYLE=path
AWS_S3_REGION_NAME=us-east-1
MEDIA_BUCKET=zola-media
R2_ACCESS_KEY_ID=<hex>
R2_BUCKET=zola-media
R2_ENDPOINT_URL=http://minio:9000
R2_PUBLIC_ENDPOINT_URL=https://api.zola-ashe.com
R2_SECRET_ACCESS_KEY=<hex>
USE_S3=True
```

Si `R2_ENDPOINT_URL` est absent ou différent → le backend n'a pas relu
le `.env`. Refaire l'étape 3 avec `--force-recreate`.

### 5. Relancer le sanity check E1

```bash
docker compose -f docker-compose.prod.yml exec backend python -c "
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
name = default_storage.save('healthcheck.txt', ContentFile(b'ok'))
print('OK :', default_storage.url(name))
default_storage.delete(name)
"
```

Attendu :

```
OK : https://api.zola-ashe.com/zola-media/healthcheck.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&...
```

Si l'URL contient bien `zola-media/` et `api.zola-ashe.com` → **fix
confirmé**, MinIO est en service en prod.

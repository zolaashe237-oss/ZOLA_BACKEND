# Intégration Cloudflare R2 (storage objet)

Le backend est **déjà prêt** à consommer R2 (`config/settings/base.py:250-272`
utilise l'API S3 avec boto3, R2 est S3-compatible). Il reste à créer le
bucket, générer les credentials et brancher.

---

## 1 · Créer le compte + bucket R2 (côté Cloudflare, ~5 min)

### 1.1 Créer un compte Cloudflare
https://dash.cloudflare.com/sign-up (email + mot de passe, 2FA recommandé)

### 1.2 Activer R2 sur le compte
Menu gauche → **R2 Object Storage** → cliquer sur **Enable R2**
- Il faut ajouter une carte bancaire même pour le tier gratuit (10 Go/mois offerts).
- Pas de facturation tant que tu restes < 10 Go stockés et < 1M requêtes classe A/mois.

### 1.3 Créer le bucket
- Cliquer **Create bucket**
- Name : `zola-ashe` (doit correspondre à la variable `R2_BUCKET` du `.env`)
- Location hint : **Europe (EEUR)** (proche de tes membres FR/Cameroun)
- Cliquer **Create bucket**

### 1.4 Récupérer l'`account-id`
Sur la page du bucket → colonne droite → **API** section → tu vois une
URL du type `https://<hex-32-chars>.r2.cloudflarestorage.com`.

Le `<hex-32-chars>` (32 hexa) est ton **Account ID**.

### 1.5 Générer des API tokens R2

Menu R2 → **Manage R2 API Tokens** → **Create API token** :

- **Token name** : `zola-ashe-prod`
- **Permissions** : `Object Read & Write`
- **Specify bucket(s)** : sélectionner `zola-ashe` uniquement (principe
  du moindre privilège — pas `All buckets`)
- **TTL** : `Forever` (ou une date lointaine)
- Cliquer **Create API Token**

Cloudflare affiche **UNE SEULE FOIS** :
- **Access Key ID** (~32 chars)
- **Secret Access Key** (~64 chars)

**Copie-les tout de suite** dans un gestionnaire de mots de passe ou un
`.env` local. Ils ne réapparaissent plus.

---

## 2 · Configurer le VPS

### 2.1 Éditer le `.env` prod

```bash
ssh edwin@2.24.15.184
cd /home/edwin/zolaashe/zola-ashe-backend
cp .env .env.backup-$(date +%Y%m%d-%H%M)   # backup
nano .env
```

Renseigner (remplacer par tes vraies valeurs) :

```env
# === Stockage — Cloudflare R2 ===
USE_S3=True
R2_ACCESS_KEY_ID=<access-key-id-de-la-1.5>
R2_SECRET_ACCESS_KEY=<secret-access-key-de-la-1.5>
R2_BUCKET=zola-ashe
R2_ENDPOINT_URL=https://<account-id-de-la-1.4>.r2.cloudflarestorage.com
# R2_PUBLIC_ENDPOINT_URL=  (optionnel — laisse vide sauf si tu as un custom domain cdn.zola-ashe.com)
AWS_S3_REGION_NAME=auto
AWS_S3_ADDRESSING_STYLE=virtual
```

⚠️ Points importants :

- `USE_S3=True` **remplace** MinIO par R2 pour TOUS les nouveaux uploads.
  Les anciens médias restent sur MinIO local (voir §4 migration).
- `AWS_S3_REGION_NAME=auto` — spécifique R2 (contrairement à AWS `us-east-1`).
- `AWS_S3_ADDRESSING_STYLE=virtual` — R2 supporte les deux mais `virtual`
  fonctionne mieux avec les URLs signées.

Sauvegarder (`Ctrl+O`, `Enter`, `Ctrl+X`).

### 2.2 Force-recreate backend + workers (recharge le `.env`)

```bash
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate \
  backend celery_worker celery_beat

# attendre healthy
until docker ps --filter "name=backend" --format '{{.Status}}' | grep -q healthy; do
  sleep 2; echo "..."
done
```

---

## 3 · Tests de fumée

### 3.1 Le backend voit bien la config R2

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "
from django.conf import settings
print('USE_S3:', settings.USE_S3)
print('bucket:', settings.AWS_STORAGE_BUCKET_NAME)
print('endpoint:', settings.AWS_S3_ENDPOINT_URL)
"
```

**Attendu** :
```
USE_S3: True
bucket: zola-ashe
endpoint: https://<account-id>.r2.cloudflarestorage.com
```

### 3.2 Upload / download / delete test round-trip

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile

# upload
path = default_storage.save('_healthcheck.txt', ContentFile(b'zola-ashe R2 test'))
print('uploaded:', path)

# read back
with default_storage.open(path) as f:
    print('content:', f.read())

# delete
default_storage.delete(path)
print('deleted')
"
```

**Attendu** : les 3 lignes `uploaded / content / deleted` sans exception.

Si tu vois `NoSuchBucket` → vérifier le nom du bucket. `InvalidAccessKeyId`
→ vérifier l'access key. `SignatureDoesNotMatch` → vérifier le secret.

### 3.3 Vérifier côté Cloudflare que l'objet a été créé puis supprimé

Dashboard R2 → bucket `zola-ashe` → **Objects** — tu peux briefly voir
`_healthcheck.txt` apparaître puis disparaître dans l'onglet Activity.

---

## 4 · Migration MinIO → R2 (optionnel — si tu as déjà des médias)

⚠️ **À faire seulement si tu as déjà des fichiers uploadés sur MinIO** que
tu veux conserver.

Option A — `rclone` (recommandé, gère les gros volumes et les reprises) :

```bash
apt update && apt install -y rclone
rclone config   # configurer 2 remotes : "minio" (source) et "r2" (dest)
rclone sync minio:zola-ashe r2:zola-ashe --progress --transfers 8
```

Option B — script Python avec boto3 (plus léger pour < 100 Mo au total) :

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "
import boto3
from django.conf import settings

# lister ancien MinIO
minio = boto3.client('s3', endpoint_url='http://minio:9000',
    aws_access_key_id='minio', aws_secret_access_key='minio12345')
r2 = boto3.client('s3', endpoint_url=settings.AWS_S3_ENDPOINT_URL,
    aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY)

for obj in minio.list_objects_v2(Bucket='zola-ashe').get('Contents', []):
    key = obj['Key']
    data = minio.get_object(Bucket='zola-ashe', Key=key)['Body'].read()
    r2.put_object(Bucket='zola-ashe', Key=key, Body=data)
    print(f'copied {key}')
"
```

---

## 5 · Rollback (si R2 pose souci)

```bash
nano .env
# repasser USE_S3=False
```

Puis :

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate backend celery_worker celery_beat
```

Django retombe sur le storage local Django (`MEDIA_ROOT`) sans casse.

---

## Checklist finale

- [ ] Compte Cloudflare créé + R2 activé
- [ ] Bucket `zola-ashe` créé, région EU
- [ ] Account ID récupéré
- [ ] API token créé (Object Read & Write, bucket-scoped) → access key + secret notés
- [ ] `.env` prod mis à jour (USE_S3=True + 4 variables R2)
- [ ] `docker compose up -d --force-recreate` backend/workers
- [ ] Test §3.1 : USE_S3 True, bucket OK
- [ ] Test §3.2 : upload/read/delete round-trip OK
- [ ] Test §3.3 : objet visible dans dashboard Cloudflare
- [ ] (facultatif) Migration MinIO → R2 avec rclone

Une fois OK : les nouveaux uploads via `default_storage` (avatars, PDFs
bibliothèque, audios, thumbnails, covers formation) vont directement sur R2.

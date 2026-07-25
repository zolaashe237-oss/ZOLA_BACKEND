# Mise en place MinIO en production

Bascule du stockage médias (uploads utilisateurs : covers, PDF, audio, vidéo)
depuis le volume local vers **MinIO** (S3-compatible, hébergé sur le même VPS).

Le navigateur accède aux fichiers via `https://${API_DOMAIN}/${MEDIA_BUCKET}/…`
(nginx path prefix, cf. `nginx/templates/default.conf.template`). Les uploads
serveur passent en direct sur `http://minio:9000` (bande passante interne).

---

## 1 · Variables `.env` à ajouter

```bash
# --- Stockage MinIO ------------------------------------------------------
USE_S3=True
MEDIA_BUCKET=zola-media                          # même nom des deux côtés
R2_ACCESS_KEY_ID=<32 caractères aléatoires>      # = MINIO_ROOT_USER
R2_SECRET_ACCESS_KEY=<48 caractères aléatoires>  # = MINIO_ROOT_PASSWORD
R2_BUCKET=zola-media                             # doit égaler MEDIA_BUCKET
R2_ENDPOINT_URL=http://minio:9000                # interne (backend → minio)
R2_PUBLIC_ENDPOINT_URL=https://api.zola-ashe.com # public (navigateur → nginx)
AWS_S3_ADDRESSING_STYLE=path                     # obligatoire pour MinIO
AWS_S3_REGION_NAME=us-east-1                     # placeholder (MinIO ignore)
```

Génération de credentials aléatoires :

```bash
openssl rand -hex 16   # → R2_ACCESS_KEY_ID
openssl rand -hex 24   # → R2_SECRET_ACCESS_KEY
```

**Important** : `R2_BUCKET` doit être **identique** à `MEDIA_BUCKET` sinon
nginx route un path vers le mauvais bucket.

**Important 2** : `R2_PUBLIC_ENDPOINT_URL` doit être `https://<votre-domaine>`
**sans** suffixe (pas de `/s3` ni autre). Le bucket sert de prefix, boto3
générera `https://api.zola-ashe.com/zola-media/<key>?X-Amz-Signature=…`.

---

## 2 · Vérifs code (déjà en place, pour info)

- `config/storages.py` — classe `PublicSignedS3Storage` : override `.url()`
  pour signer contre `R2_PUBLIC_ENDPOINT_URL`. Les PUT continuent sur
  `R2_ENDPOINT_URL` interne.
- `config/settings/base.py` — `STORAGES.default` pointe déjà sur
  `config.storages.PublicSignedS3Storage` quand `USE_S3=True`.
- `apps/content/services.py:generate_signed_url` — déjà aligné (utilise
  `S3_PUBLIC_ENDPOINT_URL`).

Aucun changement de code à faire — que de la config.

---

## 3 · Déploiement

```bash
cd ~/zolaashe/zola-ashe-backend

# 3.1  Pull du code + rebuild backend (nouvelle classe storage)
git pull --ff-only origin main
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .

# 3.2  Compléter le .env avec les vars ci-dessus, puis :
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate

# 3.3  Suivre minio-init (crée le bucket, s'arrête)
docker compose -f docker-compose.prod.yml logs -f minio-init
# → attendu : "[minio-init] bucket zola-media prêt."

# 3.4  Recharger nginx (nouveau prefix /zola-media/)
docker compose -f docker-compose.prod.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## 4 · Migration des uploads existants

Si le volume `media:` (ancien stockage local) contient déjà des fichiers, les
copier vers MinIO **avant** de supprimer le volume.

```bash
# 4.1  Vérifier ce qu'il reste dans l'ancien volume
docker run --rm -v zola-ashe-backend_media:/src alpine sh -c "ls -R /src | head -50; du -sh /src"

# 4.2  Copier via mc (client MinIO) — nom du volume à adapter
docker run --rm --network zola-ashe-backend_default \
  -v zola-ashe-backend_media:/src \
  -e MC_HOST_local="http://${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}@minio:9000" \
  minio/mc:RELEASE.2025-01-17T23-25-50Z \
  mirror --overwrite /src local/zola-media/

# 4.3  Sanity : lister le bucket
docker compose -f docker-compose.prod.yml exec minio \
  sh -c "mc alias set local http://minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD && mc ls -r local/zola-media/ | head -20"

# 4.4  Retirer l'ancien volume (une fois la migration validée)
docker volume rm zola-ashe-backend_media
```

Adapter le nom du réseau/volume selon le vrai nom Compose (`docker network ls`,
`docker volume ls`).

---

## 5 · Sanity checks post-bascule

```bash
# 5.1  Bucket accessible depuis backend
docker compose -f docker-compose.prod.yml exec backend python -c "
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
name = default_storage.save('healthcheck.txt', ContentFile(b'ok'))
print('upload OK :', name)
print('url signée:', default_storage.url(name))
default_storage.delete(name)
print('delete OK')
"

# 5.2  L'URL signée est accessible depuis l'extérieur ?
# Copier l'URL retournée ci-dessus, la coller dans un navigateur ou :
curl -sI '<url-signée>' | head -5
# attendu : HTTP/2 200 + Content-Type: text/plain

# 5.3  Uploader un vrai fichier via l'admin
# → aller sur https://api.zola-ashe.com/django-admin/content/course/add/
#   coller un PDF, sauvegarder, vérifier que la miniature s'affiche
```

---

## 6 · Pièges à connaître

- **Signature mismatch (HTTP 403 SignatureDoesNotMatch)** : nginx doit
  propager le `Host` original (`proxy_set_header Host $host;`, déjà fait).
  Si vous ajoutez un CDN devant, il devra faire pareil.
- **NoSuchBucket** : `minio-init` doit être passé (`docker compose logs
  minio-init`). Si en état failed, relancer : `docker compose up -d
  --force-recreate minio-init`.
- **Console MinIO** (:9001) : intentionnellement PAS exposée. Pour un accès
  ponctuel, ouvrir un tunnel SSH : `ssh -L 9001:localhost:9001 vps`, puis
  `docker compose port minio 9001` (nécessite un port publish ad hoc).
- **Backup** : le volume `miniodata:` contient TOUS les uploads utilisateurs.
  À sauvegarder au même titre que `pgdata:`.
- **Sécurité credentials** : `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` sont
  les identifiants **root** MinIO. Pour un multi-tenant plus tard, créer des
  users applicatifs avec `mc admin user add` et une policy restreinte au
  bucket.

---

## 7 · Rollback

Si la bascule casse la prod, revenir au stockage local :

```bash
# Repasser USE_S3=False dans .env
# Restaurer l'ancien docker-compose.prod.yml (git checkout HEAD~1 -- ...)
docker compose -f docker-compose.prod.yml up -d --force-recreate backend celery_worker celery_beat nginx
```

Les fichiers restent dans `miniodata:` (rien n'est perdu tant que le volume
existe). Une seconde tentative de bascule pourra reprendre le bucket tel quel.

---

Cross-refs :
- Redéploiement standard après pull → `REDEPLOY_APRES_PULL.md`
- Diagnostic complet → `DEPLOY_HEALTHCHECK.md`
- Pièges connus prod → dossier des runbooks

#!/bin/sh
set -e

# Attente de la base de données
echo "En attente de PostgreSQL..."
until python -c "import socket,os,urllib.parse as u; d=u.urlparse(os.environ.get('DATABASE_URL','postgres://zola:zola@db:5432/zola')); s=socket.socket(); s.connect((d.hostname, d.port or 5432)); s.close()" 2>/dev/null; do
  sleep 1
done

# Une commande explicite a été fournie (celery worker/beat, manage.py, …) :
# on l'exécute telle quelle. Surtout, on NE migre PAS ici — sinon backend +
# celery_worker + celery_beat lanceraient `migrate` en parallèle sur la même
# base et provoqueraient une race condition Postgres.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# Rôle backend (aucune commande) : migrations + statiques, puis serveur HTTP.
python manage.py migrate --noinput
python manage.py collectstatic --noinput 2>/dev/null || true

# Bucket de stockage : créé au démarrage si on utilise S3/MinIO (idempotent).
if [ "$USE_S3" = "True" ]; then
  python - <<'PY'
import os, time, boto3
from botocore.client import Config
s3 = boto3.client(
    "s3", endpoint_url=os.environ["R2_ENDPOINT_URL"],
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name=os.environ.get("AWS_S3_REGION_NAME", "us-east-1"),
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)
bucket = os.environ["R2_BUCKET"]
for _ in range(30):
    try:
        names = [b["Name"] for b in s3.list_buckets()["Buckets"]]
        if bucket not in names:
            s3.create_bucket(Bucket=bucket)
        print(f"[entrypoint] bucket objet prêt : {bucket}")
        break
    except Exception as e:
        print(f"[entrypoint] attente du stockage objet… ({e})")
        time.sleep(2)
PY
fi

# Données de démonstration (admin + membre démo + catalogue), idempotent.
# Activé par SEED_DEMO=True (dev) ; jamais en prod par défaut.
if [ "$SEED_DEMO" = "True" ]; then
  echo "[entrypoint] chargement des données de démonstration…"
  python manage.py seed_demo || echo "[entrypoint] seed_demo ignoré"
fi

if [ "$DJANGO_ENV" = "prod" ]; then
  exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers "${GUNICORN_WORKERS:-3}"
else
  exec python manage.py runserver 0.0.0.0:8000
fi

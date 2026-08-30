"""Storages personnalisés.

django-storages n'expose qu'UN endpoint (upload = download). En prod MinIO tourne
sur un endpoint interne rapide (http://minio:9000) tandis que le navigateur doit
joindre le bucket via nginx public (S3_PUBLIC_ENDPOINT_URL). Ce module override
`url()` pour signer contre l'endpoint PUBLIC, tout en laissant les PUT/GET
serveur passer par l'endpoint interne.
"""
from django.conf import settings
from storages.backends.s3 import S3Storage


class PublicSignedS3Storage(S3Storage):
    """S3Storage dont les URLs de lecture sont signées contre l'endpoint public.

    Motivation : boto3 côté django-storages signe avec `endpoint_url` (interne
    pour économiser la bande passante). Un client web ne peut pas joindre
    `http://minio:9000` — il faut re-signer avec `S3_PUBLIC_ENDPOINT_URL`
    (par ex. `https://api.zola-ashe.com` derrière nginx).
    """

    def url(self, name, parameters=None, expire=None, http_method=None):
        import mimetypes
        import boto3
        from botocore.client import Config

        endpoint = getattr(settings, "S3_PUBLIC_ENDPOINT_URL", "") or getattr(settings, "AWS_S3_ENDPOINT_URL", "")
        if endpoint and not endpoint.startswith(("http://", "https://")):
            endpoint = f"https://{endpoint}"

        try:
            client = boto3.client(
                "s3",
                endpoint_url=endpoint,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.AWS_S3_REGION_NAME,
                config=Config(
                    signature_version=settings.AWS_S3_SIGNATURE_VERSION,
                    s3={"addressing_style": settings.AWS_S3_ADDRESSING_STYLE},
                ),
            )
            params = dict(parameters or {})
            params["Bucket"] = settings.AWS_STORAGE_BUCKET_NAME
            params["Key"] = name
            params.setdefault("ResponseContentDisposition", "inline")
            mime, _ = mimetypes.guess_type(name)
            if mime:
                params.setdefault("ResponseContentType", mime)
            return client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expire or settings.AWS_QUERYSTRING_EXPIRE,
                HttpMethod=http_method,
            )
        except Exception:
            # Fallback URL directe (ex: custom domain CDN ou public bucket)
            base = endpoint.rstrip("/") if endpoint else ""
            if base:
                return f"{base}/{name.lstrip('/')}"
            return f"/{name.lstrip('/')}"

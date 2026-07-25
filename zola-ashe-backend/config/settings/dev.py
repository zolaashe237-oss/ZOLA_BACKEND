"""Environnement de développement local."""
from .base import *  # noqa: F401,F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Emails envoyés par SMTP si la clé Brevo est fournie, sinon affichés dans la console.
if env("BREVO_SMTP_KEY", default=""):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Exécution synchrone des tâches Celery en local (pas besoin de worker).
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)  # noqa: F405

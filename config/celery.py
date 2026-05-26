"""Configuration Celery — tâches asynchrones et cron (CDC : node-cron → Celery Beat)."""
import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("zola_ashe")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# --- Cron (Celery Beat) -----------------------------------------------------
# Le scheduler effectif est la base (django_celery_beat) ; ce bloc documente
# et amorce les tâches périodiques clés du CDC.
app.conf.beat_schedule = {
    # Recalcul quotidien des statuts membres — 00h00 UTC (RG-02, RG-03, RG-07).
    "daily-status-check": {
        "task": "apps.billing.tasks.daily_status_check",
        "schedule": crontab(hour=0, minute=0),
    },
    # Rapport financier mensuel — 1er du mois 06h00 UTC (RG-41).
    "monthly-financial-report": {
        "task": "apps.admin_api.tasks.monthly_financial_report",
        "schedule": crontab(hour=6, minute=0, day_of_month=1),
    },
    # Publication des formations programmées — toutes les minutes (§5.4).
    "publish-scheduled-formations": {
        "task": "apps.content.tasks.publish_scheduled_formations",
        "schedule": crontab(minute="*"),
    },
}

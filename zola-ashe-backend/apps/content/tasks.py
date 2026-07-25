"""Tâches Celery de l'app content."""
from config.celery import app


@app.task
def publish_scheduled_formations():
    """Publie les formations programmées dont l'heure de mise en ligne est atteinte.

    Programmée toutes les minutes (Celery Beat) : une formation en statut SCHEDULED
    dont `publish_at` est échu bascule automatiquement en PUBLISHED.
    """
    from .services import publish_due_formations
    return publish_due_formations()

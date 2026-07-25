from config.celery import app


# TODO: tâches Celery de l'app audit (emails, cron, traitements async).
@app.task
def ping():
    return "pong"

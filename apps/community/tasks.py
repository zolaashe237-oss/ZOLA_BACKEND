from config.celery import app


# TODO: tâches Celery de l'app community (emails, cron, traitements async).
@app.task
def ping():
    return "pong"

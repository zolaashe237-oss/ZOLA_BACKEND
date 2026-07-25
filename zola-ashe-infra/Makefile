# ZOLA ASHÉ — orchestration. Lancer toutes les cibles depuis ce dossier (zola-ashe-infra).
COMPOSE      = docker compose --env-file env/.env
COMPOSE_PROD = docker compose --env-file env/.env -f docker-compose.prod.yml

.PHONY: help init up down logs build ps migrate makemigrations superuser seed shell-backend \
        web-shell admin-shell restart prod-up prod-down prod-logs

help:                ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n",$$1,$$2}'

init:                ## Copie les fichiers .env d'exemple (à faire une fois)
	@cp -n env/.env.example       env/.env       2>/dev/null || true
	@cp -n env/.env.web.example   env/.env.web   2>/dev/null || true
	@cp -n env/.env.admin.example env/.env.admin 2>/dev/null || true
	@echo "Fichiers env prêts dans ./env — pensez à renseigner les secrets."

up:                  ## Démarre toute la stack de dev (build inclus)
	$(COMPOSE) up --build

down:                ## Arrête la stack de dev
	$(COMPOSE) down

logs:                ## Suit les logs de la stack de dev
	$(COMPOSE) logs -f

ps:                  ## Liste les services
	$(COMPOSE) ps

build:               ## Rebuild les images
	$(COMPOSE) build

restart:             ## Redémarre la stack
	$(COMPOSE) down && $(COMPOSE) up --build

migrate:             ## Applique les migrations Django
	$(COMPOSE) exec backend python manage.py migrate

makemigrations:      ## Génère les migrations Django
	$(COMPOSE) exec backend python manage.py makemigrations

superuser:           ## Crée un superadmin Django
	$(COMPOSE) exec backend python manage.py createsuperuser

seed:                ## Charge les données de démo (admin + membre + catalogue)
	$(COMPOSE) exec backend python manage.py seed_demo

shell-backend:       ## Shell dans le conteneur backend
	$(COMPOSE) exec backend bash

web-shell:           ## Shell dans le conteneur web
	$(COMPOSE) exec web sh

admin-shell:         ## Shell dans le conteneur admin
	$(COMPOSE) exec admin sh

# ─── Production ───
prod-up:             ## Démarre la stack de production
	$(COMPOSE_PROD) up -d

prod-down:           ## Arrête la stack de production
	$(COMPOSE_PROD) down

prod-logs:           ## Suit les logs de production
	$(COMPOSE_PROD) logs -f

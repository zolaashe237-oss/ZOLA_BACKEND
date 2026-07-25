# ZOLA ASHÉ — Backend autonome (orchestration locale & prod).
# Lancer toutes les cibles depuis la racine du dépôt.
COMPOSE      = docker compose --env-file .env
COMPOSE_PROD = docker compose --env-file .env -f docker-compose.prod.yml

.PHONY: help init up down logs build ps restart shell migrate makemigrations \
        superuser seed test schema collectstatic \
        prod-up prod-down prod-logs prod-restart prod-init-cert prod-renew-cert backup

help:                ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n",$$1,$$2}'

init:                ## Copie .env.example -> .env (à faire une fois)
	@cp -n .env.example .env 2>/dev/null && echo ".env créé — renseignez les secrets." || echo ".env existe déjà."

# ─── Développement ───
up:                  ## Démarre le backend de dev (build inclus)
	$(COMPOSE) up -d --build

down:                ## Arrête la stack de dev
	$(COMPOSE) down

logs:                ## Suit les logs (Ctrl+C pour quitter)
	$(COMPOSE) logs -f

ps:                  ## Liste les services
	$(COMPOSE) ps

build:               ## Reconstruit l'image backend
	$(COMPOSE) build backend

restart:             ## Redémarre la stack de dev
	$(COMPOSE) down && $(COMPOSE) up -d --build

shell:               ## Shell dans le conteneur backend
	$(COMPOSE) exec backend bash

migrate:             ## Applique les migrations Django
	$(COMPOSE) exec backend python manage.py migrate

makemigrations:      ## Génère les migrations Django
	$(COMPOSE) exec backend python manage.py makemigrations

superuser:           ## Crée un superadmin Django
	$(COMPOSE) exec backend python manage.py createsuperuser

seed:                ## Charge les données de démo (admin + membre + catalogue)
	$(COMPOSE) exec backend python manage.py seed_demo

test:                ## Exécute la suite de tests Django
	$(COMPOSE) exec backend python manage.py test

schema:              ## Génère le schéma OpenAPI (drf-spectacular)
	$(COMPOSE) exec backend python manage.py spectacular --file /app/schema.yaml

collectstatic:       ## Force la collecte des fichiers statiques (sert nginx)
	$(COMPOSE) exec backend python manage.py collectstatic --noinput

# ─── Production ───
prod-init-cert:      ## (1×) Génère le certif Let's Encrypt — port 80 doit être libre
	@. ./.env && \
	docker run --rm -p 80:80 \
	  -v $$PWD/nginx/certs:/etc/letsencrypt \
	  -v $$PWD/nginx/acme:/var/www/certbot \
	  certbot/certbot certonly --standalone \
	  -d $$API_DOMAIN --email $$ACME_EMAIL \
	  --agree-tos --no-eff-email --non-interactive

prod-up:             ## Démarre la stack de production (nginx TLS + PgBouncer + Gunicorn + certbot)
	$(COMPOSE_PROD) up -d

prod-down:           ## Arrête la stack de production
	$(COMPOSE_PROD) down

prod-logs:           ## Suit les logs de production
	$(COMPOSE_PROD) logs -f

prod-restart:        ## Redémarre la prod en récupérant la dernière image
	$(COMPOSE_PROD) pull && $(COMPOSE_PROD) up -d

prod-renew-cert:     ## Force un renouvellement immédiat des certificats
	$(COMPOSE_PROD) run --rm certbot renew --webroot --webroot-path=/var/www/certbot --force-renewal
	$(COMPOSE_PROD) exec nginx nginx -s reload

# ─── Sauvegardes ───
backup:              ## Dump compressé de la base Postgres (-> backups/)
	./scripts/backup-db.sh

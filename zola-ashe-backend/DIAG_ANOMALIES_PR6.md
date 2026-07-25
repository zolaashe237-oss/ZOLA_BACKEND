# Diagnostic anomalies après déploiement PR #6

Résultats des sanity checks §1-§6 sur le VPS `srv1705007` à 2026-07-20 02:09 UTC.

---

## Résumé statut

| Check | Status | Note |
|---|---|---|
| §1 Ping Gemini | ✅ | `pong: gemini-flash-latest` (9.2s) |
| §2 Rename `GENERALE → MEMBRE` | ✅ | 1 formation en `MEMBRE`, aucun `GENERALE` restant |
| §3 Tarifs `SubscriptionPlan` seedés | ✅ RÉSOLU | Faux positif : `db_table='subscription_plans'` (pas `billing_subscriptionplan`) |
| §4 Reload nginx | ✅ | via `docker compose restart nginx` |
| §5 Swagger UI | ✅ RÉSOLU | Path custom : `/api/docs/` (pas `/api/schema/swagger-ui/`) |
| §6 2 replicas backend | ✅ | backend-1 et backend-2 healthy |

## Cause réelle des 2 "anomalies"

Aucune anomalie en prod — le runbook `POST_DEPLOY_CHECKS.md` v1 avait
2 noms hardcodés incorrects :

- `apps/billing/models.py` override `db_table` pour toutes ses tables
  (`subscriptions`, `payments`, `subscription_plans`), donc aucune
  table `billing_*` n'existe.
- `config/urls.py` mappe Swagger sur `path("api/docs/", ...)` — le
  path drf-spectacular par défaut (`/api/schema/swagger-ui/`) n'est
  pas exposé.

Corrigé dans `POST_DEPLOY_CHECKS.md` v2.

---

## Commandes finales à taper sur le VPS (v2)

Copie-colle exactement ces 2 blocs.

### Bloc 1 · Vérif tarifs seedés

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT kind, tranche_amount, price_total, is_active FROM subscription_plans;"
```

**Attendu** :

```
     kind      | tranche_amount | price_total | is_active
---------------+----------------+-------------+-----------
 INSCRIPTION   |          47500 |       47500 | t
 COTISATION    |          10000 |       60000 | t
 BRANCHE_FEMME |          25000 |       25000 | t
 BRANCHE_ENFANT|          20000 |       20000 | t
 DON           |                |           0 | t
```

### Bloc 2 · Vérif Swagger UI

```bash
curl -sI https://api.zola-ashe.com/api/docs/ | head -3
```

**Attendu** :

```
HTTP/2 200
server: nginx/1.27.5
date: ...
```

---

### Si les 2 blocs sont ✅ → déploiement OK, envoyer messages équipe.
### Si un des 2 blocs échoue → coller la sortie ici.


---

## ⚠️ ALERTE BUSINESS — flux paiement bloqué

Sans `SubscriptionPlan` en base, la fonction `resolve_plan()` retombe sur
les défauts `settings.PRICE_*` (**10 000 FCFA pour INSCRIPTION**).
Un membre qui paye maintenant paye **10 000 au lieu de 47 500**.

→ **Ne pas activer le flux paiement** tant que la table n'est pas créée
et seedée correctement.

---

## Commandes de diag à taper sur le VPS

### A · État des migrations billing

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py showmigrations billing
```

Cherche `0006_seed_default_plans` — doit être `[X]` (appliquée). Si `[ ]`,
la migration n'a pas encore tourné → appliquer avec :

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py migrate billing
```

### B · Tables billing en base

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c "\dt" | grep -i billing
```

Attendu : plusieurs tables `billing_*` dont `billing_subscriptionplan`. Si
le nom est différent (`db_table` overridé), adapter la requête §3 du
runbook avec le bon nom.

### C · Cerner le 404 Swagger

```bash
# schéma OpenAPI brut (doit être 200)
curl -sI https://api.zola-ashe.com/api/schema/ | head -3

# racine API (pour comprendre si nginx route bien)
curl -sI https://api.zola-ashe.com/api/ | head -3
```

---

## Hypothèses

### Anomalie §3 — tarifs seedés

1. **Migration `billing.0006_seed_default_plans` pas dans l'image buildée**
   → peu probable (le fichier est dans le repo, `git log` montre le
   commit qui l'a ajouté avant la PR #6).
2. **DB déjà migrée à un stade antérieur avec des migrations manquantes**
   → possible si prod a un historique local différent (0006 marquée
   appliquée dans `django_migrations` mais son opération n'a pas tourné).
3. **`db_table` overridé** sur `SubscriptionPlan` → alors la table
   existe sous un autre nom. Vérifier via §B.
4. **Migrate a filtré silencieusement** billing car pas de "changes" —
   improbable, migrate applique toujours ce qui est en `[ ]`.

Le §A tranche entre ces hypothèses.

### Anomalie §5 — Swagger UI 404

1. **`collectstatic` non fait** en prod → assets Swagger UI absents du
   volume partagé `staticfiles:/app/staticfiles`. Nginx sert les
   fichiers `.js/.css` de Swagger UI directement depuis ce volume.
   → Fix : `docker compose exec backend python manage.py collectstatic --noinput`
   puis `docker compose restart nginx`.
2. **URL différente** — drf-spectacular expose parfois
   `/api/schema/swagger-ui/` **ou** `/api/docs/`. Vérifier la config
   dans `config/urls.py`. Le §C aide à cerner.
3. **Nginx `location`** manquant pour ce path — vérifier
   `nginx/nginx.conf`.

---

## Actions correctives selon diag

- Si §A montre `0006_seed_default_plans` en `[ ]` :
  ```bash
  docker compose -f docker-compose.prod.yml exec backend \
    python manage.py migrate billing
  ```
- Si §A montre `[X]` mais §B ne liste pas `billing_subscriptionplan` :
  la migration a été marquée applied sans que le DDL tourne (bug de
  data migration). Contourner :
  ```bash
  # unfake puis re-run
  docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
    "DELETE FROM django_migrations WHERE app='billing' AND name='0004_subscriptionplan';"
  docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
    "DELETE FROM django_migrations WHERE app='billing' AND name='0005_add_plan_kind_and_branches';"
  docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
    "DELETE FROM django_migrations WHERE app='billing' AND name='0006_seed_default_plans';"
  docker compose -f docker-compose.prod.yml exec backend \
    python manage.py migrate billing
  ```

- Si §5 Swagger 404 confirmé après `collectstatic` :
  ```bash
  docker compose -f docker-compose.prod.yml exec backend \
    python manage.py collectstatic --noinput
  docker compose -f docker-compose.prod.yml restart nginx
  # puis re-test
  curl -sI https://api.zola-ashe.com/api/schema/swagger-ui/ | head -3
  ```

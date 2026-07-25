# Sanity checks post-déploiement PR #6

À exécuter dans l'ordre sur le VPS, dans `/home/edwin/zolaashe/zola-ashe-backend`,
après `up -d --force-recreate` + `migrate` réussis.

---

## 1 · Ping Gemini réel (~20 s)

Valide que `GEMINI_API_KEY` du `.env` est OK et que Google sert bien le
modèle demandé.

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "from apps.ai_quiz.gemini_client import ping; print(ping())"
```

**Attendu** : `pong: gemini-flash-latest`

En cas d'erreur `403` / `404` : vérifier `GEMINI_MODEL=gemini-flash-latest`
(pas `gemini-2.5-flash`) et la validité de la clé sur
https://aistudio.google.com/apikey.

---

## 2 · Data intégrity — rename `GENERALE → MEMBRE`

La migration `content.0008` renomme les valeurs `branche='GENERALE'` en
`'MEMBRE'` dans 5 tables. Vérifier qu'il n'en reste aucune :

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT branch, COUNT(*) FROM formations GROUP BY branch;"

docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT branche, COUNT(*) FROM audio_items GROUP BY branche;"

docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT branche, COUNT(*) FROM library_pdfs GROUP BY branche;"
```

**Attendu** : uniquement `MEMBRE` / `FEMME` / `ENFANT`. Aucun `GENERALE`.

Si un `GENERALE` traîne : c'est un cas non couvert par la migration —
patcher à la main :

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "UPDATE formations SET branch='MEMBRE' WHERE branch='GENERALE';"
```

---

## 3 · Tarifs seedés (BUSINESS CRITICAL)

La migration `billing.0006_seed_default_plans` insère les vrais tarifs.
**À vérifier avant qu'un membre paye** :

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT kind, tranche_amount, price_total, is_active FROM subscription_plans;"
```

**Attendu** :

| kind | tranche_amount | price_total | is_active |
|---|---|---|---|
| INSCRIPTION | 47 500 | 47 500 | true |
| COTISATION | 10 000 | 60 000 | true |
| BRANCHE_FEMME | 25 000 | 25 000 | true |
| BRANCHE_ENFANT | 20 000 | 20 000 | true |
| DON | null | 0 | true |

⚠️ Si un tarif ne correspond PAS à ce qui doit être facturé :

```bash
# désactive TOUS les plans (retour aux fallbacks settings.PRICE_*)
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "UPDATE subscription_plans SET is_active=false;"

# ou corrige un tarif précis
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "UPDATE subscription_plans SET tranche_amount=<X>, price_total=<Y> WHERE kind='INSCRIPTION';"
```

---

## 4 · Reload nginx (routes propres, nouveaux endpoints exposés)

Après un déploiement avec de nouvelles URLs backend, nginx peut garder
son upstream en cache. Un reload propre le force à re-résoudre les
containers backend re-créés.

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -t
# doit afficher : nginx: configuration file /etc/nginx/nginx.conf test is successful

docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

Si nginx a été aussi recréé (dans un up sans `--no-deps`), pas besoin de
reload — il est déjà frais.

**Alternative si `nginx -s reload` échoue** : restart complet du service :

```bash
docker compose -f docker-compose.prod.yml restart nginx
```

---

## 5 · Smoke réseau — Swagger + endpoints IA/memoir

```bash
# Swagger accessible (⚠️ path custom : /api/docs/, pas swagger-ui/)
curl -sI https://api.zola-ashe.com/api/docs/ | head -3
# attendu : HTTP/2 200

# Nouveaux endpoints présents dans le schéma OpenAPI
curl -s https://api.zola-ashe.com/api/schema/ | \
  grep -oE '"/api/admin/(quiz/generate-ai|memoir|youtube-import)[^"]*"' | sort -u
```

Doit lister au moins :
- `/api/admin/quiz/generate-ai/` (sprint IA-BE)
- `/api/admin/memoir/…` (Albert)
- `/api/admin/youtube-import/…` (Albert)

---

## 6 · Vérifier les 2 replicas backend en équilibrage

```bash
docker compose -f docker-compose.prod.yml ps backend
# doit lister backend-1 ET backend-2, tous deux "healthy"

# tap plusieurs fois — nginx doit alterner les backends (loop = 2 replicas)
for i in 1 2 3 4; do
  curl -s https://api.zola-ashe.com/api/schema/ -o /dev/null -w "req=%{http_code} host=%{header:x-backend-container:-}\n"
done
```

Si un replica reste `unhealthy`, regarder ses logs :

```bash
docker compose -f docker-compose.prod.yml logs --tail=50 backend
```

---

## 7 · Checklist rapide finale

- [ ] Ping Gemini → `pong: gemini-flash-latest`
- [ ] Aucun `GENERALE` restant dans `formations` / `audio_items` / `library_pdfs`
- [ ] Tarifs `SubscriptionPlan` conformes (INSCRIPTION 47500)
- [ ] `nginx -t` OK + reload
- [ ] Swagger 200 + endpoints IA/memoir présents
- [ ] 2 replicas backend `healthy`

Si tout est vert : envoyer les messages équipe (Garnel/Cabrel/Kevin/Albert)
depuis `note.md` § 3.

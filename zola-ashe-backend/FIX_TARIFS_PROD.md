# FIX urgent — Réactiver les tarifs SubscriptionPlan

## Contexte

Les 5 plans dans `subscription_plans` ont été désactivés par erreur
(`UPDATE subscription_plans SET is_active=false` — 5 lignes touchées).

Tant qu'ils sont inactifs, `resolve_plan()` retombe sur les défauts
`settings.PRICE_*` :

- INSCRIPTION : **10 000 FCFA** au lieu de 47 500
- COTISATION : **2 000 FCFA/mois** au lieu de 10 000
- BRANCHE_FEMME/ENFANT : **15 000 FCFA** au lieu de 25 000/20 000
- DON : identique

→ Un membre qui paye maintenant paye **le mauvais tarif**.

---

## Commandes à taper sur le VPS

### 1. Réactiver les 5 plans

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "UPDATE subscription_plans SET is_active=true;"
```

**Attendu** : `UPDATE 5`

### 2. Vérifier que les 5 sont bien actifs avec les bons tarifs

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "SELECT kind, tranche_amount, price_total, is_active FROM subscription_plans ORDER BY kind;"
```

**Attendu** (toutes les lignes `is_active=t`) :

```
      kind      | tranche_amount | price_total | is_active
----------------+----------------+-------------+-----------
 BRANCHE_ENFANT |          20000 |       20000 | t
 BRANCHE_FEMME  |          25000 |       25000 | t
 COTISATION     |          10000 |       60000 | t
 DON            |                |           0 | t
 INSCRIPTION    |          47500 |       47500 | t
```

### 3. Confirmer côté application (le cache resolve_plan est per-request, rien à redémarrer)

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "from apps.billing.services import resolve_plan; p = resolve_plan('INSCRIPTION'); print(f'INSCRIPTION -> {p.amount} FCFA')"
```

**Attendu** : `INSCRIPTION -> 47500 FCFA`

---

## Si un tarif doit vraiment être changé (par ex. baisser INSCRIPTION à 40000)

**NE PAS désactiver.** Modifier la valeur en place :

```bash
docker exec zola-ashe-backend-db-1 psql -U zola -d zola -c \
  "UPDATE subscription_plans SET tranche_amount=40000, price_total=40000 WHERE kind='INSCRIPTION';"
```

Remplacer `40000` par le nouveau tarif et vérifier avec le SELECT du §2.

# Fix — `No such image: postgres:15` au redéploiement

Rencontré sur le VPS après `docker build` + `docker compose up -d --pull=never`.
Deux problèmes distincts dans la même séance, à traiter séparément.

---

## 1 · Blocage immédiat — images de base absentes

### Symptôme

```
[+] up 2/3
 ✔ Network zola-a... Created
 ✘ Container zola... Error response from daemon: No such image: postgres:15
Error response from daemon: No such image: postgres:15
```

### Cause racine

Le flag `--pull=never` bloque **TOUS** les pulls, y compris les images externes
(`postgres:15`, `redis:7`, `nginx`, `pgbouncer`) que Docker n'a pas encore en
local. Ce flag est utile pour **protéger l'image backend** buildée localement,
mais il devient un piège si les images de base ne sont pas déjà présentes
(cas : fraîche install, `docker system prune` récent, VPS recréé…).

### Fix — pré-tirer les externes, puis `up`

```bash
# 1. Pré-tirer les images externes (celles qui ne sont PAS buildées localement)
docker compose -f docker-compose.prod.yml pull db redis pgbouncer nginx certbot

# 2. Relancer avec --pull=never (protège ton image backend fraîchement buildée)
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate
```

### Fallback si `docker compose pull` râle sur un service

```bash
docker pull postgres:15
docker pull redis:7
docker pull nginx:1.27-alpine       # adapter au tag exact du compose
docker pull edoburu/pgbouncer:latest  # adapter au tag exact du compose
```

### Diag pour savoir ce qui manque exactement

```bash
# Liste les images déclarées par le compose prod
docker compose -f docker-compose.prod.yml config | grep 'image:' | sort -u

# Liste les images déjà présentes en local
docker images | grep -E 'postgres|redis|nginx|pgbouncer|zola-ashe'
```

Compare : chaque image du 1er listing doit apparaître dans le 2e (sauf
l'image backend qui vient du `docker build` local).

---

## 2 · Pollution du repo — `grep.exe.stackdump` commités

### Symptôme

Le `git pull` de `27d14ef` a ajouté 6 fichiers `grep.exe.stackdump` dans
plusieurs `apps/*/` et `config/settings/`.

### Cause racine

Ce sont des **crash dumps de `grep.exe`** générés par Cygwin ou Git-for-Windows.
Un dev qui code sous Windows avec git bash a eu un plantage et les fichiers
ont fini stagés puis pushés. Ils n'ont rien à faire dans le repo.

### Fix côté dev (Windows) — nettoyer et prévenir

```bash
# En local, dans zola-ashe-backend/
find . -name '*.stackdump' -delete
echo '*.stackdump' >> .gitignore
git add -A && git commit -m "chore: ignore stackdump files (crash dumps Windows)"
git push origin main
```

### Impact prod

Aucun — ces fichiers ne sont pas lus par Django. À nettoyer par hygiène pour
éviter que ça se répande.

---

## 3 · À mettre à jour dans `REDEPLOY_APRES_PULL.md`

Ajouter une étape **§2.5** entre le `docker build` et le `docker compose up` :

```markdown
# 2.5. Vérifier que les images externes sont présentes (sinon les pré-tirer)
docker compose -f docker-compose.prod.yml pull db redis pgbouncer nginx certbot
```

Ainsi `--pull=never` ne bloquera plus quand les images de base ont été purgées.

---

## Voir aussi

- `REDEPLOY_APRES_PULL.md` — séquence standard (à patcher §2.5)
- `DEPLOY_TROUBLESHOOT.md` — §1 : No services to build (autre erreur voisine)

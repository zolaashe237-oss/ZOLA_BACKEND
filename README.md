# ZOLA ASHÉ — MVP 1

Plateforme communautaire, éducative et spirituelle : vitrine publique, espace
membre (contenus, formations, communauté) et back-office d'administration.

Ce dossier contient l'application complète, prête à démarrer en local avec
**Docker** en une seule commande.

---

## 1. Prérequis

- **Docker** et **Docker Compose** (Docker Desktop sur Mac/Windows, ou Docker
  Engine + plugin compose sur Linux).
- Aucune autre installation : tout (base de données, stockage, services) tourne
  dans des conteneurs.

Vérifier :

```bash
docker --version
docker compose version
```

---

## 2. Lancement (une commande)

Depuis le dossier `zola-ashe-infra` :

```bash
cd zola-ashe-infra
docker compose --env-file env/.env up --build
```

> Le premier démarrage construit les images (téléchargement + installation des
> dépendances) : cela peut prendre **quelques minutes**. Les démarrages suivants
> sont quasi instantanés.

Au démarrage, l'application prépare **automatiquement** :
- la base de données (migrations),
- le stockage des médias,
- des **données de démonstration** (un compte administrateur, un compte membre
  et un catalogue de contenus) pour pouvoir tester immédiatement.

Pour lancer en arrière-plan (sans bloquer le terminal), ajouter `-d` :

```bash
docker compose --env-file env/.env up --build -d
```

---

## 3. Accès

Une fois les services démarrés :

| Interface | Adresse |
|-----------|---------|
| **Site & espace membre** | http://localhost:3000 |
| **Back-office (admin)** | http://localhost:3010 |
| API | http://localhost:8010/api/ |
| **Documentation API (Swagger)** | http://localhost:8010/api/docs/ |
| Documentation API (Redoc) | http://localhost:8010/api/redoc/ |

### Comptes de test par défaut

Créés automatiquement par les données de démonstration au premier démarrage :

| Rôle | Identifiant | Mot de passe | Se connecte sur |
|------|-------------|--------------|-----------------|
| **Administrateur** | `admin@zola-ashe.com` | `Admin12345!` | Back-office — http://localhost:3010 |
| **Membre** (adhésion active) | `demo@zola-ashe.com` | `Demo12345!` | Site & espace membre — http://localhost:3000 |

Console de stockage **MinIO** : http://localhost:9001 — identifiants `zolaminio` / `zolaminiosecret`.

> Astuce : pour tester le site **et** le back-office en même temps, ouvrez l'un
> des deux dans une fenêtre de navigation privée (la session est partagée sur
> `localhost`).

---

## 4. Arrêter

```bash
cd zola-ashe-infra
docker compose --env-file env/.env down
```

Pour repartir d'une base totalement vierge (réinitialise les données) :

```bash
docker compose --env-file env/.env down -v
```

---

## 5. Paiement & emails — mode démo vs réel

Par défaut (sans clé renseignée), l'application fonctionne en **mode démonstration**,
de façon **complète** et sans service externe :

- **Paiement** : le bouton « Activer mon adhésion » mène à une page de
  **paiement simulé** ; en confirmant, le membre devient immédiatement actif
  (aucun débit réel).
- **Emails** : aucun email n'est envoyé ; le **code de vérification (OTP)** est
  affiché directement à l'écran lors de l'inscription.

### Activer le paiement réel (Swinmo)

1. Créer un compte sur **Swinmo** et récupérer la **clé secrète API** (`sk_…`).
2. Renseigner dans `zola-ashe-infra/env/.env` :
   ```env
   SWINMO_SECRET_KEY=sk_votre_cle
   SWINMO_WEBHOOK_SECRET=votre_secret_webhook
   ```
3. Côté Swinmo, configurer l'URL de **webhook** vers :
   `https://VOTRE_DOMAINE/api/billing/webhooks/swinmo/`
4. Redémarrer la stack. Le paiement passe automatiquement en mode réel
   (la page de simulation est désactivée).

### Activer les emails réels (Brevo)

1. Créer un compte **Brevo** (ex-Sendinblue) et générer une **clé SMTP**.
2. Renseigner dans `zola-ashe-infra/env/.env` :
   ```env
   BREVO_SMTP_USER=votre_identifiant_smtp
   BREVO_SMTP_KEY=votre_cle_smtp
   DEFAULT_FROM_EMAIL=no-reply@votre-domaine.com
   ```
3. Redémarrer la stack. Les emails (vérification, confirmations, rappels) sont
   alors envoyés réellement (le code OTP n'est plus affiché à l'écran).

> La bascule démo → réel est **automatique** : dès qu'une clé est présente, le
> service correspondant passe en mode réel. Aucune autre modification n'est
> nécessaire.

---

## 6. Contenu du dossier

| Dossier | Rôle |
|---------|------|
| `zola-ashe-web` | Site public + espace membre |
| `zola-ashe-admin` | Back-office d'administration |
| `zola-ashe-backend` | API et logique métier |
| `zola-ashe-infra` | Orchestration Docker (à utiliser pour lancer) |

---

*ZOLA ASHÉ — MVP 1.*
# zolaashe

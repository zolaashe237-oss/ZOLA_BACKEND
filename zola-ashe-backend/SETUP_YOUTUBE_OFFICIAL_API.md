# Setup — Extraction transcriptions YouTube via API officielle

Bascule de `youtube-transcript-api` (lib non officielle, endpoint
`timedtext` non documenté) vers **YouTube Data API v3** avec OAuth 2.0.

## Contrainte importante

`captions.download` de l'API officielle exige :

1. Un token **OAuth 2.0** (pas juste une clé API) avec le scope
   `https://www.googleapis.com/auth/youtube.force-ssl`.
2. Le compte OAuth doit être **propriétaire** de la vidéo (ou avoir
   l'autorisation explicite du propriétaire).

→ **Cette bascule marche uniquement pour vos propres vidéos** (chaîne
YouTube ZOLA ASHÉ). Pour des vidéos tierces, l'API retournera 403 et
`extract_youtube_transcript()` lèvera `TranscriptNotAvailable`.

## Étape 1 · Créer le projet Google Cloud

1. Ouvrir [console.cloud.google.com](https://console.cloud.google.com).
2. Barre du haut → sélecteur de projet → **Nouveau projet** :
   - Nom : `zola-ashe-youtube`
   - Cliquer « Créer », attendre 5-10 s, sélectionner le nouveau projet.

## Étape 2 · Activer YouTube Data API v3

1. Menu ≡ → **API et services** → **Bibliothèque**.
2. Rechercher « YouTube Data API v3 » → cliquer → **Activer**.

## Étape 3 · Configurer l'OAuth consent screen

1. Menu ≡ → **API et services** → **OAuth consent screen**.
2. User type : **External** → Créer.
3. Formulaire :
   - App name : `ZOLA ASHÉ Backend`
   - User support email : `dev999411@gmail.com`
   - Developer contact : idem
   - **Save and continue**.
4. Scopes : **Add or Remove Scopes** → cocher
   `https://www.googleapis.com/auth/youtube.force-ssl` → **Update** →
   **Save and continue**.
5. Test users : ajouter le compte Google qui possède la chaîne YouTube
   (celui-là seulement pourra générer le refresh token) → **Save**.

### ⚠️ Publier l'app pour éviter l'expiration à 7 jours

Par défaut, un OAuth consent screen en mode **Testing** invalide les
refresh tokens **au bout de 7 jours** → la prod tombe en panne
silencieusement.

Solution : **passer en « In production »** (bouton « Publish app » de la
même page OAuth consent screen).

Comme le scope `youtube.force-ssl` est classé « sensitive » par Google,
la publication déclenche théoriquement une **vérification** — MAIS tant
que l'app reste **interne** à un seul compte utilisateur (le
propriétaire de la chaîne), on peut cliquer « Publish » sans lancer la
vérification et les refresh tokens ne sont plus expirés.

## Étape 4 · Créer un OAuth 2.0 Client ID

1. Menu ≡ → **API et services** → **Credentials**.
2. **Create credentials** → **OAuth client ID**.
3. Application type : **Desktop app**.
4. Name : `zola-ashe-backend-desktop`.
5. **Create** → une popup affiche `Client ID` et `Client Secret`. Les
   copier tous les deux.

## Étape 5 · Générer le refresh token (bootstrap)

Sur un poste **avec navigateur** (ton laptop, pas le VPS) :

```bash
cd ~/Desktop/Revolution/zolaashe/zola-ashe-backend

# Activer le venv puis installer la nouvelle dep
source venv/bin/activate  # ou l'équivalent
pip install google-auth-oauthlib

# Bootstrap OAuth
python manage.py youtube_oauth_bootstrap \
  --client-id <CLIENT_ID_COPIE_ETAPE_4> \
  --client-secret <CLIENT_SECRET_COPIE_ETAPE_4>
```

Un onglet de navigateur s'ouvre :

1. Choisir le compte Google **propriétaire de la chaîne YouTube**.
2. Écran d'avertissement « Google hasn't verified this app » → cliquer
   « Advanced » → « Go to zola-ashe-backend-desktop (unsafe) ».
3. Cocher le scope → **Continue**.

La commande affiche alors dans le terminal :

```
=== SUCCÈS ===
YOUTUBE_OAUTH_CLIENT_ID=…
YOUTUBE_OAUTH_CLIENT_SECRET=…
YOUTUBE_OAUTH_REFRESH_TOKEN=1//…
```

**Copier les 3 lignes** telles quelles.

## Étape 6 · Renseigner `.env` (local ET prod)

### Local

```bash
nano ~/Desktop/Revolution/zolaashe/zola-ashe-backend/.env
```

Coller les 3 lignes reçues du bootstrap.

### Prod (VPS)

```bash
ssh <vps>
cd /home/edwin/zolaashe/zola-ashe-backend

# Backup
cp .env .env.bak.$(date +%Y%m%d-%H%M)

nano .env
# Coller les 3 lignes
```

## Étape 7 · Rebuild et redémarrer

### Local (docker)

```bash
docker compose build backend
docker compose up -d --force-recreate backend celery_worker
```

### Prod

```bash
cd /home/edwin/zolaashe/zola-ashe-backend
git pull --ff-only origin main
docker build -t ghcr.io/edwintchakounte/zola-ashe-backend:latest .
docker compose -f docker-compose.prod.yml up -d --pull=never --force-recreate \
  backend celery_worker celery_beat
```

## Étape 8 · Sanity check

### 8a · Healthcheck OAuth (sans vidéo, teste seulement l'auth)

Vérifie que les 3 vars OAuth permettent de rafraîchir un access_token —
utile pour :
- confirmer que la config est bonne juste après le déploiement,
- détecter tôt qu'un refresh_token est expiré ou révoqué (à cron-er
  quotidiennement en prod).

```bash
docker compose exec backend python manage.py youtube_oauth_healthcheck
```

Sortie attendue :

```
OK : refresh_token valide, access_token régénéré.
     Access token expire à : 2026-08-01T10:34:12+00:00
     Client ID utilisé : 123456789-abc...apps.googleusercontent.com
```

Erreurs :
- `Variables OAuth manquantes dans .env : …` → renseigner l'/les vars.
- `Refresh du token OAuth échoué : …` → soit token révoqué (relancer
  bootstrap), soit consent screen en mode « Testing » et 7 jours
  écoulés depuis la génération (publier l'app puis relancer bootstrap).

### 8b · Sanity check extraction complète (avec vidéo)

```bash
docker compose exec backend python -c "
from apps.ai_quiz.extractors.youtube import extract_youtube_transcript
# URL d'une vidéo de la chaine ZOLA ASHÉ (propriétaire = compte OAuth)
text = extract_youtube_transcript('https://youtu.be/<ID_VIDEO_TESTS>')
print('OK, %d caractères' % len(text))
print(text[:200] + '…')
"
```

Attendu : les 200 premiers caractères du transcript.

Si `TranscriptNotAvailable: captions.download a échoué … 403` → le
compte OAuth n'est pas propriétaire de la vidéo. Utiliser une vidéo de
votre chaîne uniquement.

## Rollback

Si problème :

1. Retirer les 3 vars OAuth du `.env` → `extract_youtube_transcript`
   lèvera immédiatement `TranscriptNotAvailable` (pas de tentative
   d'appel).
2. Réinstaller l'ancienne lib le temps de la fix :
   `pip install youtube-transcript-api>=0.6` (elle n'est plus dans
   `requirements.txt` mais reste installable ponctuellement).
3. Git revert le commit de bascule si besoin de récupérer l'ancien
   code Python.

## Suivi des quotas

L'API a un quota gratuit de **10 000 unités/jour**.

- `captions.list` = 50 unités
- `captions.download` = 200 unités

→ ~40 vidéos/jour extraites, largement suffisant pour ZOLA ASHÉ.

Console de suivi :
[cloud.google.com/apis/dashboard](https://console.cloud.google.com/apis/dashboard).

## Cross-refs

- Extracteur : `apps/ai_quiz/extractors/youtube.py`
- Commande bootstrap : `apps/ai_quiz/management/commands/youtube_oauth_bootstrap.py`
- Settings : `config/settings/base.py` (`YOUTUBE_OAUTH_*`)
- Env template : `.env.example`

# Notes techniques — `zola-ashe-backend`

Documentation d'architecture interne (complémentaire des runbooks
opérationnels à la racine du backend et du README applicatif).

## Index

- [**Quiz YouTube — Architecture OAuth 2.0**](quiz-youtube-architecture.md)
  Les 3 variables d'environnement nécessaires, cartographie complète des
  fichiers, flux de bootstrap, flux Celery de génération de quiz, flux
  admin synchrone, cycle de vie des tokens OAuth. **6 diagrammes SVG.**

## Convention

- Les `.md` de la racine backend (ex. `SETUP_YOUTUBE_OFFICIAL_API.md`) =
  runbooks orientés **action** (étapes à faire).
- Les notes ici (dossier `notes/`) = documentation orientée
  **compréhension** (comment ça marche, pourquoi c'est fait comme ça).

Les images sont des **SVG inline** (pas de dépendance externe, s'affichent
partout — GitHub, VS Code, GitLab, viewers markdown).

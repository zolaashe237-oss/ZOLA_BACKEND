#!/bin/sh
# nginx — boucle de reload en arrière-plan.
#
# T+90 s : reload pour prendre le vrai cert obtenu par certbot-init (qui
# remplace le cert auto-signé temporaire posé par 00-bootstrap-tls.sh).
# Puis reload toutes les 6 h pour intégrer les renouvellements certbot.
#
# Mis en arrière-plan via `&` ; quand le script se termine, le sous-shell
# est réparenté à PID 1 (nginx après l'exec final de l'entrypoint).
( sleep 90; nginx -s reload 2>/dev/null || true
  while :; do
      sleep 6h
      nginx -s reload 2>/dev/null || true
  done
) </dev/null >/dev/null 2>&1 &

exit 0

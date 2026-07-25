#!/bin/sh
# nginx — bootstrap TLS au premier démarrage.
#
# Si aucun certificat n'existe pour ${API_DOMAIN}, génère un certificat
# auto-signé temporaire (1 jour) afin que nginx puisse charger la conf
# HTTPS sans crasher. Le service `certbot-init` (compose) le remplace
# ensuite par un vrai cert Let's Encrypt via le challenge HTTP-01 webroot,
# et nginx recharge automatiquement à T+90 s (cf. command nginx).
set -e

if [ -z "${API_DOMAIN}" ]; then
    echo "[bootstrap-tls] ERREUR : variable API_DOMAIN non définie." >&2
    exit 1
fi

CERT_DIR="/etc/letsencrypt/live/${API_DOMAIN}"
CERT_FILE="${CERT_DIR}/fullchain.pem"
KEY_FILE="${CERT_DIR}/privkey.pem"

if [ -f "${CERT_FILE}" ] && [ -f "${KEY_FILE}" ]; then
    echo "[bootstrap-tls] Certificat déjà présent pour ${API_DOMAIN} — rien à faire."
    exit 0
fi

echo "[bootstrap-tls] Aucun certificat — génération d'un auto-signé temporaire (1 j)."
echo "[bootstrap-tls] (remplacé par Let's Encrypt via certbot-init, reload auto à T+90s)"

# openssl n'est pas garanti dans nginx:alpine — install à la volée si absent
# (idempotent grâce à --no-cache).
command -v openssl >/dev/null 2>&1 || apk add --no-cache openssl >/dev/null

mkdir -p "${CERT_DIR}"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "${KEY_FILE}" \
    -out "${CERT_FILE}" \
    -subj "/CN=${API_DOMAIN}" \
    -addext "subjectAltName=DNS:${API_DOMAIN}" >/dev/null 2>&1

echo "[bootstrap-tls] Cert auto-signé posé : ${CERT_FILE}"

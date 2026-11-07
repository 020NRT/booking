#!/usr/bin/env bash
# Creates .env for docker compose with your domain and strong random secrets.
#   ./deploy/init-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { echo ".env уже существует — удалите его, если хотите создать заново."; exit 1; }
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }

read -rp "Домен сайта (например reserve.kz): " DOMAIN
read -rp "Email администратора Reserve: " ADMIN_EMAIL
read -rp "Загрузить 3 демо-ресторана? (y/N): " DEMO
ADMIN_PASSWORD="Adm$(rand 14)7"

cat > .env <<ENV
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(rand 32)
JWT_SECRET=$(rand 48)
PAYMENT_WEBHOOK_SECRET=$(rand 40)
SUPERADMIN_EMAIL=$ADMIN_EMAIL
SUPERADMIN_PASSWORD=$ADMIN_PASSWORD
SEED_DEMO=$([ "${DEMO:-n}" = "y" ] && echo true || echo false)
DEFAULT_DEPOSIT_KZT=5000
PLATFORM_COMMISSION_PERCENT=10
PAYMENT_PROVIDER=mock
# E-mail (необязательно)
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Reserve <no-reply@$DOMAIN>
ENV
chmod 600 .env
echo
echo "Готово: .env создан."
echo "Вход в админ-панель: https://$DOMAIN/admin"
echo "  логин:  $ADMIN_EMAIL"
echo "  пароль: записан в .env (строка SUPERADMIN_PASSWORD) — сохраните его в надёжном месте."

#!/bin/sh
# Container start: migrate the database, ensure the Super Admin exists, run the API.
set -e

# Started as root (e.g. a mounted disk owned by root): fix media permissions,
# then continue as the unprivileged "app" user.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$MEDIA_DIR" && chown -R app:app "$MEDIA_DIR" /app/backend
  exec python -c 'import os, sys; os.setgroups([]); os.setgid(1000); os.setuid(1000); os.execvp(sys.argv[1], sys.argv[1:])' "$0" "$@"
fi

echo "Applying database migrations..."
alembic upgrade head

if [ -n "$SUPERADMIN_PASSWORD" ]; then
  python -m app.seed --superadmin
fi
if [ "$SEED_DEMO" = "true" ]; then
  python -m app.seed --demo
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}" --proxy-headers --forwarded-allow-ips='*'

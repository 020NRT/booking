#!/usr/bin/env bash
# One-command local start for Reserve (macOS / Linux).
#
#   ./scripts/start.sh
#
# First run installs everything (takes a few minutes); later runs start in seconds.
# Uses its own PostgreSQL data folder (.pgdata) on port 5433, so it does not touch
# any other PostgreSQL you may have. Stop everything with Ctrl+C.
#
# Ports can be changed: PG_PORT=5433 API_PORT=8000 WEB_PORT=5173 ./scripts/start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_PORT="${PG_PORT:-5433}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
PGDATA="$ROOT/.pgdata"
export LC_ALL=C LANG=C   # PostgreSQL refuses to start with some macOS locale settings

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- tools -----------------------------------------------------------------
for p in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@15/bin \
         /usr/local/opt/postgresql@16/bin /usr/local/opt/postgresql@15/bin /usr/lib/postgresql/*/bin; do
  [ -x "$p/pg_ctl" ] && { PATH="$p:$PATH"; break; }
done
command -v pg_ctl >/dev/null || die "PostgreSQL не найден. Установите: brew install postgresql@16"
command -v node >/dev/null || die "Node.js не найден. Установите: brew install node"
PY=""
for c in python3.14 python3.13 python3.12 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then PY="$c"; break; fi
done
[ -n "$PY" ] || die "Нужен Python 3.12+. Установите: brew install python@3.13"

# --- database --------------------------------------------------------------
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  say "Создаю базу данных в .pgdata"
  initdb -D "$PGDATA" -U reserve --auth=trust -E UTF8 --locale=C >/dev/null
fi
if ! pg_isready -h 127.0.0.1 -p "$PG_PORT" -q; then
  say "Запускаю PostgreSQL на порту $PG_PORT"
  pg_ctl -D "$PGDATA" -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$PGDATA/server.log" -w start >/dev/null
fi
for db in reserve reserve_test; do
  psql -h 127.0.0.1 -p "$PG_PORT" -U reserve -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || createdb -h 127.0.0.1 -p "$PG_PORT" -U reserve "$db"
done
export DATABASE_URL="postgresql+psycopg://reserve@127.0.0.1:$PG_PORT/reserve"
export TEST_DATABASE_URL="postgresql+psycopg://reserve@127.0.0.1:$PG_PORT/reserve_test"
export PUBLIC_BASE_URL="http://localhost:$WEB_PORT" CORS_ORIGINS="http://localhost:$WEB_PORT"

# --- backend ---------------------------------------------------------------
cd "$ROOT/backend"
if [ ! -x .venv/bin/uvicorn ]; then
  say "Устанавливаю зависимости backend (один раз)"
  "$PY" -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
if [ ! -f .env ]; then
  say "Создаю backend/.env со случайными секретами"
  secret() { "$PY" -c 'import secrets; print(secrets.token_urlsafe(32))'; }
  sed -e "s|^JWT_SECRET=.*|JWT_SECRET=$(secret)|" \
      -e "s|^PAYMENT_WEBHOOK_SECRET=.*|PAYMENT_WEBHOOK_SECRET=$(secret)|" \
      -e "s|^SUPERADMIN_PASSWORD=.*|SUPERADMIN_PASSWORD=Admin$("$PY" -c 'import secrets; print(secrets.token_hex(5))')|" \
      .env.example > .env
fi
say "Применяю миграции и начальные данные"
.venv/bin/alembic upgrade head >/dev/null
.venv/bin/python -m app.seed --superadmin
.venv/bin/python -m app.seed --demo | grep -v '^skip' || true

# --- frontend --------------------------------------------------------------
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  say "Устанавливаю зависимости frontend (один раз)"
  npm install --silent
fi

# --- run -------------------------------------------------------------------
say "Запускаю API на :$API_PORT"
(cd "$ROOT/backend" && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT") &
API_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$API_PORT/api/health" >/dev/null && break
  kill -0 "$API_PID" 2>/dev/null || die "API не запустился, смотрите сообщения выше"
  sleep 0.5
done
cleanup() { kill "$API_PID" 2>/dev/null || true; echo; echo "Остановлено. База остаётся запущенной; выключить: pg_ctl -D \"$PGDATA\" stop"; }
trap cleanup EXIT INT TERM

cat <<EOF

  ✅ Reserve запущен
     Сайт:              http://localhost:$WEB_PORT
     Панель ресторана:  http://localhost:$WEB_PORT/partner
     Админ-панель:      http://localhost:$WEB_PORT/admin
     API-документация:  http://localhost:$API_PORT/api/docs

     Логин Super Admin — SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD в backend/.env
     Логины демо-ресторанов — backend/demo-credentials.txt
     Остановить — Ctrl+C

EOF
VITE_BACKEND_URL="http://127.0.0.1:$API_PORT" npm run dev -- --port "$WEB_PORT" --strictPort

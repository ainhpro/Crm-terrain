#!/usr/bin/env bash
# Base de développement locale persistante (émulation Supabase), sur le port 54322.
#   npm run db:start   démarre (crée et remplit la base au premier lancement)
#   npm run db:stop    arrête
#   npm run db:reset   efface tout, recrée, applique les migrations et les données de démonstration
#   npm run db:migrate applique les nouvelles migrations
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.local/pgdata"
SOCK="$ROOT/.local/pgsock"
PORT="${DEV_DB_PORT:-54322}"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[[ -x "$PG_BIN/initdb" ]] || { echo "PostgreSQL introuvable (initdb)." >&2; exit 1; }

RUN=()
if [[ "$(id -u)" == "0" ]]; then RUN=(runuser -u postgres --); fi
PSQL=(psql -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

running() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; }

start() {
  mkdir -p "$ROOT/.local" "$SOCK"
  [[ ${#RUN[@]} -gt 0 ]] && chown postgres "$SOCK"
  local fresh=0
  if [[ ! -d "$DATA" ]]; then
    mkdir -p "$DATA"
    [[ ${#RUN[@]} -gt 0 ]] && chown -R postgres "$DATA" "$SOCK"
    "${RUN[@]}" "$PG_BIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
    fresh=1
  fi
  if ! running; then
    "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -l "$SOCK/pg.log" -w \
      -o "-p $PORT -k $SOCK -c listen_addresses=localhost" start >/dev/null
  fi
  if [[ $fresh == 1 ]]; then
    "${PSQL[@]}" -d postgres -c "create database crm"
    "${PSQL[@]}" -d crm -f "$ROOT/supabase/tests/supabase-shim.sql"
    "${PSQL[@]}" -d crm -c "create table if not exists public._dev_migrations (name text primary key, applied_at timestamptz default now())"
    migrate
    "${PSQL[@]}" -d crm -f "$ROOT/scripts/seed.sql"
    echo "Base créée et remplie (données de démonstration)."
  fi
  echo "Base prête : postgres://postgres@localhost:$PORT/crm"
}

migrate() {
  for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
    name="$(basename "$f")"
    done_already="$("${PSQL[@]}" -d crm -tAc "select 1 from public._dev_migrations where name = '$name'")"
    if [[ -z "$done_already" ]]; then
      "${PSQL[@]}" -d crm -f "$f"
      "${PSQL[@]}" -d crm -c "insert into public._dev_migrations (name) values ('$name')"
      echo "Migration appliquée : $name"
    fi
  done
}

stop() { running && "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null || true; }

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  migrate) start >/dev/null; migrate ;;
  reset) stop; rm -rf "$DATA"; start ;;
  *) echo "usage: dev-db.sh start|stop|reset|migrate" >&2; exit 1 ;;
esac

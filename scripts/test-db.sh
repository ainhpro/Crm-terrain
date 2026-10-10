#!/usr/bin/env bash
# Lance les tests de base de données sur un Postgres local jetable.
# - Si TEST_DATABASE_URL est défini, crée dessus une base au nom unique, supprimée à la fin
#   (serveur local exigé, sauf TEST_DB_ALLOW_REMOTE=1). DATABASE_URL n'est jamais utilisé.
# - Sinon, crée un cluster temporaire (initdb + pg_ctl), le supprime à la fin.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  [[ -x "$PG_BIN/initdb" ]] || { echo "initdb introuvable : installez PostgreSQL ou définissez TEST_DATABASE_URL" >&2; exit 1; }

  TMP="$(mktemp -d)"
  PORT="${PG_TEST_PORT:-54329}"
  # initdb refuse de tourner en root : on passe par l'utilisateur postgres.
  RUN=()
  if [[ "$(id -u)" == "0" ]]; then
    chown postgres "$TMP"
    RUN=(runuser -u postgres --)
  fi

  cleanup() {
    "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
  }
  trap cleanup EXIT

  "${RUN[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust --no-sync >/dev/null
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -w \
    -o "-p $PORT -k $TMP -c listen_addresses=localhost -c fsync=off" start >/dev/null
  export TEST_DATABASE_URL="postgres://postgres@localhost:$PORT/postgres"
fi

cd "$ROOT"
npx vitest run --config vitest.db.config.ts "$@"

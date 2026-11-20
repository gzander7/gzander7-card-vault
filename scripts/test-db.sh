#!/usr/bin/env bash
# Applies every migration to a fresh database and runs the pgTAP tests in
# supabase/tests. Uses the Supabase CLI when Docker is available (as CI does);
# otherwise starts a throwaway local PostgreSQL with scripts/db/supabase-shim.sql.
set -euo pipefail
cd "$(dirname "$0")/.."

# Files newer than the last migration recorded on production (supabase/production-migrations.json).
# Recorded migrations are history: they ran once, verbatim, and are not re-run.
pending_migrations() {
  local last
  last=$(grep -o '"version": *"[0-9]*"' supabase/production-migrations.json | grep -o '[0-9]\{14\}' | sort | tail -1)
  for migration in supabase/migrations/*.sql; do
    local version
    version=$(basename "$migration" | cut -d_ -f1)
    if [ "$version" \> "$last" ]; then echo "$migration"; fi
  done
}

if command -v supabase >/dev/null && docker info >/dev/null 2>&1; then
  supabase db start
  supabase db reset --local
  # Migrations not yet on production must be safe to apply twice: they may be pasted into the SQL editor.
  for migration in $(pending_migrations); do
    PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 \
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f "$migration" >/dev/null
  done
  exec supabase test db
fi

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL server binaries not found. Install postgresql and postgresql-<version>-pgtap, or Docker with the Supabase CLI." >&2; exit 1; }
command -v pg_prove >/dev/null || { echo "pg_prove not found. Install pgtap (it provides pg_prove)." >&2; exit 1; }

WORK="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
RUN=()
if [ "$(id -u)" = 0 ]; then
  chown postgres "$WORK"
  RUN=(runuser -u postgres --)
fi
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/log" -o "-p $PORT -k $WORK -c listen_addresses=''" -w start >/dev/null

export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres PGOPTIONS="-c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

psql_q -f scripts/db/supabase-shim.sql
for migration in supabase/migrations/*.sql; do
  psql_q -f "$migration" >/dev/null
done
# Migrations not yet on production must be safe to apply twice: they may be pasted into the SQL editor.
for migration in $(pending_migrations); do
  psql_q -f "$migration" >/dev/null
done
find supabase/tests -name "*.sql" -print0 | sort -z | xargs -0 pg_prove

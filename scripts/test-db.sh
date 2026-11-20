#!/usr/bin/env bash
# Applies every migration to a fresh database and runs the pgTAP tests in
# supabase/tests. Uses the Supabase CLI when Docker is available (as CI does);
# otherwise starts a throwaway local PostgreSQL with scripts/db/supabase-shim.sql.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v supabase >/dev/null && docker info >/dev/null 2>&1; then
  supabase db start
  supabase db reset --local
  # Every migration must be safe to apply twice (the README's paste-into-SQL-editor path relies on it).
  for migration in supabase/migrations/*.sql; do
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
# Every migration must be safe to apply twice.
for migration in supabase/migrations/*.sql; do
  psql_q -f "$migration" >/dev/null
done
find supabase/tests -name "*.sql" -print0 | sort -z | xargs -0 pg_prove

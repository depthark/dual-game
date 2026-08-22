#!/usr/bin/env bash
#
# One-time setup for the global leaderboard.
#
# Creates the D1 database, applies the schema, and writes the resulting
# database_id into wrangler.toml. Safe to re-run: it reuses an existing
# database rather than creating a second one.
#
# Prerequisite:  npx wrangler login
#
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="dual-scores"

command -v jq >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }

echo "==> checking authentication"
npx wrangler whoami </dev/null

echo "==> ensuring D1 database '$DB_NAME' exists"
if npx wrangler d1 info "$DB_NAME" </dev/null >/dev/null 2>&1; then
  echo "    already exists — reusing"
else
  npx wrangler d1 create "$DB_NAME" </dev/null
fi

# `d1 info --json` is the stable way to read the uuid back out.
DB_ID="$(npx wrangler d1 info "$DB_NAME" --json </dev/null | jq -r '.uuid')"
[ -n "$DB_ID" ] && [ "$DB_ID" != "null" ] || { echo "could not read database id"; exit 1; }
echo "    database_id = $DB_ID"

echo "==> writing database_id into wrangler.toml"
python3 - "$DB_ID" <<'PY'
import re, sys
db_id = sys.argv[1]
p = 'wrangler.toml'
s = open(p).read()
s = re.sub(r'database_id = "[^"]*"', f'database_id = "{db_id}"', s)
open(p, 'w').write(s)
print('    ok')
PY

echo "==> applying schema to the remote database"
npx wrangler d1 execute "$DB_NAME" --remote --file=migrations/0001_init.sql </dev/null

echo
echo "Done. Next:"
echo "  1. git add wrangler.toml && git commit && git push   (Pages picks up the binding)"
echo "  2. verify:  curl -s https://dual-game.pages.dev/api/scores | jq"

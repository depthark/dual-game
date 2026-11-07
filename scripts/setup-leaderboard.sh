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
if npx wrangler d1 list --json </dev/null | jq -e --arg n "$DB_NAME" '.[] | select(.name == $n)' >/dev/null; then
  echo "    already exists — reusing"
else
  npx wrangler d1 create "$DB_NAME" </dev/null
fi

# Read the uuid from the account's database list — `d1 info <name>` resolves
# the name through wrangler.toml, which still holds the placeholder on a first
# run and so fails exactly when this script is needed.
DB_ID="$(npx wrangler d1 list --json </dev/null | jq -r --arg n "$DB_NAME" '.[] | select(.name == $n) | .uuid')"
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
for f in migrations/*.sql; do
  echo "    $f"
  npx wrangler d1 execute "$DB_NAME" --remote --file="$f" -y </dev/null
done

echo
echo "Done. Next:"
echo "  1. git add wrangler.toml && git commit && git push   (Pages picks up the binding)"
echo "  2. verify:  curl -s https://dual-game.pages.dev/api/scores | jq"

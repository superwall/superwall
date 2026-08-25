#!/usr/bin/env bash
# One-command dev install of the superwall CLI from this checkout.
#
#   ./scripts/install-dev-cli.sh          install only (keeps your current login)
#   ./scripts/install-dev-cli.sh stg      install + log in against staging (SUPERWALL_STAGING_HOST)
#   ./scripts/install-dev-cli.sh local    install + log in against a local API (:3001)
#   ./scripts/install-dev-cli.sh prd      install + log in against production
#
# The login's host is saved to the session, so after this every command
# targets the chosen environment with no env vars. A project-local .env with
# SUPERWALL_API_HOST still overrides per directory (the bin loads it from cwd).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null || { echo "bun is required: https://bun.sh"; exit 1; }

TARGET="${1:-}"
case "$TARGET" in
  "" ) HOST="" ;;
  local ) HOST="http://localhost:3001" ;;
  stg ) HOST="${SUPERWALL_STAGING_HOST:?set SUPERWALL_STAGING_HOST to the staging API host}" ;;
  prd ) HOST="https://api.superwall.com" ;;
  * ) echo "Unknown environment: $TARGET (use local, stg, or prd)"; exit 1 ;;
esac

bun install
bun run --filter '@superwall/cli' build
(cd packages/superwall && bun link)

BIN="$HOME/.bun/bin/superwall"
echo
"$BIN" --version
echo "Done — \`superwall\` / \`sw\` now run from this checkout."
echo "Framework source changes are live immediately; CLI changes need"
echo "\`bun run --filter '@superwall/cli' build\` (or rerun this script)."

if [ -n "$HOST" ]; then
  echo
  echo "Logging in against $TARGET ($HOST)…"
  SUPERWALL_API_HOST="$HOST" "$BIN" login
fi

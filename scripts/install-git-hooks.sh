#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.git/hooks/prepare-commit-msg"
cp "$ROOT/scripts/prepare-commit-msg" "$HOOK"
chmod +x "$HOOK"
echo "Installed prepare-commit-msg hook (strips Cursor co-author trailers)."

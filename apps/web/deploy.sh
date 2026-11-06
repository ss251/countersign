#!/usr/bin/env bash
# Deploy the countersign console to Railway: the static build of apps/web behind server.ts.
#
#   bash apps/web/deploy.sh [ref]     # ref defaults to origin/main: production tracks main
#
# The console is built from `git archive <ref>`, never from the working tree, so what is live is
# exactly a commit. `ref=.` builds the working tree instead (for a one-off check, not production).
#
# Once per machine: `railway login`, then `railway link` to the countersign project from the repo
# root. The web service's variables live in Railway: HUB_URL, and RELAY_URL / MERCHANT_URL once the
# Whitechain services are public. The page always calls /hub, /relay and /merchant-api on its own
# origin; server.ts forwards them.
#
# Environment: RAILWAY_SERVICE (default "web"); DRY_RUN=1 stages without uploading;
# VITE_HUB_URL= (set but empty) builds a console that shows labelled fixtures.
set -euo pipefail

ref="${1:-origin/main}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
work="$(mktemp -d "${TMPDIR:-/tmp}/countersign-console-src.XXXXXX")"
stage="$(mktemp -d "${TMPDIR:-/tmp}/countersign-console.XXXXXX")"
trap 'rm -rf "$work" "$stage"' EXIT

if [ "$ref" = "." ]; then
  src="$root"
  label="working tree"
else
  git -C "$root" fetch -q origin 2>/dev/null || true
  git -C "$root" archive --format=tar "$ref" | tar -x -C "$work"
  src="$work"
  label="$ref ($(git -C "$root" rev-parse --short "$ref"))"
  echo "installing $label"
  (cd "$src" && bun install --frozen-lockfile >/dev/null)
fi

echo "building apps/web from $label"
(
  cd "$src/apps/web"
  VITE_HUB_URL="${VITE_HUB_URL-/hub}" \
  VITE_RELAY_URL="${VITE_RELAY_URL-/relay}" \
  VITE_MERCHANT_URL="${VITE_MERCHANT_URL-/merchant-api}" \
    bunx --bun vite build --logLevel warn
)

cp -R "$src/apps/web/dist" "$stage/dist"
rm -f "$stage"/dist/assets/*.map
cp "$src/apps/web/server.ts" "$stage/server.ts"
cp "$here/deploy/Dockerfile" "$stage/Dockerfile"
echo "staged $(du -sh "$stage" | cut -f1)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  trap 'rm -rf "$work"' EXIT
  echo "DRY_RUN=1: not uploading. Stage left at $stage"
  exit 0
fi

railway up "$stage" --path-as-root --no-gitignore --service "${RAILWAY_SERVICE:-web}" --detach --message "console $label"

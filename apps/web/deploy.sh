#!/usr/bin/env bash
# Deploy the countersign console to Railway: the static build of apps/web behind server.ts.
#
#   bash apps/web/deploy.sh
#
# Once per machine: `railway login`, then `railway link` to the countersign project from the
# repo root. Once per service, in Railway, set the web service's variables:
#   HUB_URL       where the hub listens, e.g. http://hub.railway.internal:8787 or its public URL
#   RELAY_URL     the Whitechain relayer (optional)
#   MERCHANT_URL  the merchant service (optional)
# The page always calls /hub, /relay and /merchant-api on its own origin; server.ts forwards them.
# Environment for this script: RAILWAY_SERVICE (default "web"), DRY_RUN=1 to stage without uploading,
# VITE_HUB_URL= (set but empty) to build a console that shows labelled fixtures while no hub is deployed.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/countersign-console.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

echo "building apps/web"
(
  cd "$here"
  VITE_HUB_URL="${VITE_HUB_URL-/hub}" \
  VITE_RELAY_URL="${VITE_RELAY_URL-/relay}" \
  VITE_MERCHANT_URL="${VITE_MERCHANT_URL-/merchant-api}" \
    bunx --bun vite build --logLevel warn
)

cp -R "$here/dist" "$stage/dist"
rm -f "$stage"/dist/assets/*.map
cp "$here/server.ts" "$stage/server.ts"
cp "$here/deploy/Dockerfile" "$stage/Dockerfile"
echo "staged $(du -sh "$stage" | cut -f1) in $stage"

if [ "${DRY_RUN:-0}" = "1" ]; then
  trap - EXIT
  echo "DRY_RUN=1: not uploading. Stage left at $stage"
  exit 0
fi

railway up "$stage" --path-as-root --no-gitignore --service "${RAILWAY_SERVICE:-web}" --detach \
  --message "console $(git -C "$here" rev-parse --short HEAD)"

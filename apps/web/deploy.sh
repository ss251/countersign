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
# VITE_HUB_URL defaults to the production hub: the console is live by default, and ?hub=off is the
# only way to fixtures. VITE_HUB_URL=/hub builds against this server's same-origin proxy instead.
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

# The Privy app id is public, but it lives on the web service. Read it here, where this checkout is linked to
# Railway: inside the build's temporary copy the CLI is not linked, the read came back empty, and the console
# shipped with email sign-in off (23:08 IST). An empty id is said out loud, never shipped silently.
# set -e would end the script on a failed read with no word, so the read may fail and the guard below speaks.
privy_id="${VITE_PRIVY_APP_ID-$( (cd "$here" && railway variables --service "${RAILWAY_SERVICE:-web}" --kv 2>/dev/null | sed -n 's/^VITE_PRIVY_APP_ID=//p') || true)}"
if [ -z "$privy_id" ] && [ "${ALLOW_NO_PRIVY:-0}" != "1" ]; then
  echo "deploy: VITE_PRIVY_APP_ID is empty, so the console would ship with email sign-in off; set it or ALLOW_NO_PRIVY=1" >&2
  exit 1
fi

echo "building apps/web from $label"
(
  cd "$src/apps/web"
  VITE_HUB_URL="${VITE_HUB_URL:-https://hub-production-e85e.up.railway.app}" \
  VITE_RELAY_URL="${VITE_RELAY_URL-/relay}" \
  VITE_MERCHANT_URL="${VITE_MERCHANT_URL-/merchant-api}" \
  VITE_PRIVY_APP_ID="$privy_id" \
    bunx --bun vite build --logLevel warn
)

# The built bundle must carry that id, or sign-in is off whatever the variable said.
if [ -n "$privy_id" ] && ! grep -rqF "$privy_id" "$src/apps/web/dist/assets"; then
  echo "deploy: the bundle does not carry the Privy app id, so nothing was uploaded" >&2
  exit 1
fi

# The phone page (apps/phone, cs-phone's lane) is hosted at /phone/ once the ref carries it. It dials the
# hub's websocket directly, so the console needs no proxy for it; both VITE_ values are public URLs.
if [ -f "$src/apps/phone/package.json" ]; then
  echo "building apps/phone from $label"
  (
    cd "$src/apps/phone"
    VITE_HUB_URL="${VITE_HUB_URL:-https://hub-production-e85e.up.railway.app}" VITE_CONSOLE_URL=../ \
      bunx --bun vite build --logLevel warn
  )
fi

# STEER-2225: never ship a bundle that could ask for an approval, a permit or eth_sign. The check reads the
# source maps, so it runs before they are dropped; a ref without the script is checked by this checkout's copy.
grep_script="$src/apps/web/scripts/wallet-grep.ts"
[ -f "$grep_script" ] || grep_script="$here/scripts/wallet-grep.ts"
bun "$grep_script" "$src/apps/web/dist" || { echo "deploy: the bundle failed the wallet check, so nothing was uploaded" >&2; exit 1; }

cp -R "$src/apps/web/dist" "$stage/dist"
rm -f "$stage"/dist/assets/*.map
if [ -d "$src/apps/phone/dist" ]; then
  cp -R "$src/apps/phone/dist" "$stage/dist/phone"
  rm -f "$stage"/dist/phone/assets/*.map
fi
cp "$src/apps/web/server.ts" "$stage/server.ts"
cp "$here/deploy/Dockerfile" "$stage/Dockerfile"
echo "staged $(du -sh "$stage" | cut -f1)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  trap 'rm -rf "$work"' EXIT
  echo "DRY_RUN=1: not uploading. Stage left at $stage"
  exit 0
fi

railway up "$stage" --path-as-root --no-gitignore --service "${RAILWAY_SERVICE:-web}" --detach --message "console $label"

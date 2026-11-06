#!/usr/bin/env bash
# Deploy the Whitechain relay (packages/relay/src/server.ts) to Railway from an exact commit.
#
#   bash deploy-relay.sh [ref]      # ref defaults to origin/main; run it from the cs-wc worktree
#
# It stages `git archive <ref>` (committed files only, nothing local), adds relay.Dockerfile, and runs
# `railway up` on that stage, against the service whitechain-relay of project countersign.
#
# The relay's variables live in Railway, never here:
#   PORT and RELAY_PORT (8402), RELAY_DB (/data/relay.sqlite on the service volume), RELAY_URL,
#   WHITECHAIN_RPC_URLS (Ankr), RELAY_PAYEES (the merchant), RELAY_CAP_WEI_PER_HOUR (the hourly WBT
#   ceiling), and the secret WC_RELAYER_PRIVATE_KEY, which is set once with
#   `railway variable set WC_RELAYER_PRIVATE_KEY --stdin --service whitechain-relay`.
#
# DRY_RUN=1 stages and stops without uploading.
set -euo pipefail

ref="${1:-origin/main}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git rev-parse --show-toplevel)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/countersign-relay.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

git -C "$root" archive --format=tar "$ref" | tar -x -C "$stage"
cp "$here/relay.Dockerfile" "$stage/Dockerfile"
sha="$(git -C "$root" rev-parse --short "$ref")"
echo "staged the relay at $ref ($sha), $(du -sh "$stage" | cut -f1)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  trap - EXIT
  echo "DRY_RUN=1: not uploading. Stage left at $stage"
  exit 0
fi

railway up "$stage" --path-as-root --no-gitignore --service "${RAILWAY_SERVICE:-whitechain-relay}" --detach --message "whitechain relay $sha"

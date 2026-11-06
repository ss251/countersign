#!/usr/bin/env bash
# Deploy the hub (apps/hub) to Railway from an exact commit.
#
#   bash deploy/railway/deploy-hub.sh [ref]      # ref defaults to cs/int
#
# Stages `git archive <ref>` (committed files only, nothing local), adds hub.Dockerfile, and runs
# `railway up` on that stage. The hub's variables live in Railway, never here:
#   PORT, HUB_DB (/data/hub.sqlite on the service volume), HUB_PUBLIC_URL, ARC_ESCROW, ARC_RPC_URL,
#   and the secret CS_RELAYER_KEY, set once with `railway variable set CS_RELAYER_KEY --stdin`.
# DRY_RUN=1 stages and stops without uploading.
set -euo pipefail

ref="${1:-cs/int}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/countersign-hub.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

git -C "$root" archive --format=tar "$ref" | tar -x -C "$stage"
cp "$root/deploy/railway/hub.Dockerfile" "$stage/Dockerfile"
sha="$(git -C "$root" rev-parse --short "$ref")"
echo "staged hub at $ref ($sha), $(du -sh "$stage" | cut -f1)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  trap - EXIT
  echo "DRY_RUN=1: not uploading. Stage left at $stage"
  exit 0
fi

railway up "$stage" --path-as-root --no-gitignore --service "${RAILWAY_SERVICE:-hub}" --detach --message "hub $sha"

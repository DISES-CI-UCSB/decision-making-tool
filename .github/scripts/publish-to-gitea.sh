#!/usr/bin/env bash
# Publishes frontend/ and backend/ from this workspace as the roots of their Gitea repositories.
#
# Usage: bash .github/scripts/publish-to-gitea.sh [all|frontend|backend] [--dry-run]
#
# `git subtree split` is deterministic, so each publish is a fast-forward of the previous one.
# The push never forces: a rejected push means Gitea has commits that did not come from here,
# and someone must reconcile them by hand.
set -euo pipefail

GITEA_SSH_BASE="${GITEA_SSH_BASE:-ssh://git@gitea.parquesnacionales.gov.co:23/priorizando-naturaleza}"
GITEA_BRANCH="${GITEA_BRANCH:-test}"
SOURCE_REF="${SOURCE_REF:-HEAD}"

target="${1:-all}"
dry_run="${2:-}"

case "$target" in
  all) sides=(frontend backend) ;;
  frontend | backend) sides=("$target") ;;
  *) echo "Unknown target '$target'. Use all, frontend, or backend." >&2; exit 2 ;;
esac

for side in "${sides[@]}"; do
  echo "Splitting $side/ from $SOURCE_REF..."
  split_commit="$(git subtree split --prefix="$side" "$SOURCE_REF")"
  remote_url="$GITEA_SSH_BASE/$side.git"

  if [[ "$dry_run" == "--dry-run" ]]; then
    echo "Dry run: would push $split_commit to $remote_url ($GITEA_BRANCH)"
    continue
  fi

  echo "Pushing $split_commit to $remote_url ($GITEA_BRANCH)"
  git push "$remote_url" "$split_commit:refs/heads/$GITEA_BRANCH"
done

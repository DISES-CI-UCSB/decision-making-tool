#!/bin/sh
set -eu

if [ "${1:-}" = "hydrate" ]; then
  shift
  exec python /backend/scripts/hydrate.py "$@"
fi

exec "$@"

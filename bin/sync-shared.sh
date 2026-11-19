#!/usr/bin/env bash
# Script: Sync Beacon shared library into every backend service
# Purpose: The Lambda packager only zips each service folder, so the canonical shared library
#          (backend/_shared/beacon) is copied into backend/<service>/beacon. The copies are
#          COMMITTED so ./bin/deploy-backend.sh works on its own; backend/tests/test_shared_sync.py
#          fails if any copy drifts (ADR-002).
# Usage: ./bin/sync-shared.sh [--check]
#   --check   do not copy; exit 1 if any service copy differs from the source

set -e

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [--check]"
    echo "Copy backend/_shared/beacon into each backend service (or verify with --check)"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 || exit 1; pwd -P)"
SOURCE="$PROJECT_ROOT/backend/_shared/beacon"
MODE="${1:-sync}"

[ -d "$SOURCE" ] || { echo "ERROR: $SOURCE not found"; exit 1; }

STATUS=0
for req in "$PROJECT_ROOT"/backend/*/requirements.txt; do
    svc_dir="$(dirname "$req")"
    svc="$(basename "$svc_dir")"
    case "$svc" in _*|.*) continue ;; esac
    target="$svc_dir/beacon"
    if [ "$MODE" = "--check" ]; then
        if ! diff -r -q -x '__pycache__' "$SOURCE" "$target" > /dev/null 2>&1; then
            echo "DRIFT: backend/$svc/beacon differs from backend/_shared/beacon"
            STATUS=1
        else
            echo "OK:    backend/$svc/beacon"
        fi
    else
        rm -rf "$target"
        cp -R "$SOURCE" "$target"
        find "$target" -name '__pycache__' -type d -prune -exec rm -rf {} +
        echo "Synced backend/$svc/beacon"
    fi
done
exit $STATUS

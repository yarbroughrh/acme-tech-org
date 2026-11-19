#!/usr/bin/env bash
# Script: Beacon one-step deploy
# Purpose: Sync the shared library into every service, then run the UNCHANGED workshop scripts
#          (deploy-backend.sh, then deploy-frontend.sh). Either workshop script still works on its
#          own because the synced copies are committed (ADR-002).
# Usage: ./bin/deploy.sh [aws|local] [--backend-only|--frontend-only]

set -e

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [aws|local] [--backend-only|--frontend-only]"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
ENVIRONMENT="${1:-aws}"
PART="${2:-all}"

"$SCRIPT_DIR/sync-shared.sh"

if [ "$PART" != "--frontend-only" ]; then
    "$SCRIPT_DIR/deploy-backend.sh" "$ENVIRONMENT"
fi
if [ "$PART" != "--backend-only" ]; then
    "$SCRIPT_DIR/deploy-frontend.sh" "$ENVIRONMENT"
fi

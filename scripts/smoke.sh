#!/usr/bin/env bash
# Beacon smoke test: signs in as every demo role and exercises the critical path.
# Usage: ./scripts/smoke.sh [BASE_URL]
#   BASE_URL defaults to the cloud URL; use http://localhost:3001 for local (via the CORS proxy).
# Demo passwords can be overridden with SMOKE_<ROLE>_PASSWORD env vars (see README demo accounts).

set -uo pipefail

BASE_URL="${1:-https://d1u6z5us0d06jy.cloudfront.net}"
BASE_URL="${BASE_URL%/}"
PASS=0
FAIL=0

command -v jq > /dev/null || { echo "ERROR: jq is required"; exit 2; }

declare -A EMAILS=([admin]=admin@acme.example [pmo]=pmo@acme.example [pm]=pm@acme.example [analyst]=analyst1@acme.example [exec]=exec@acme.example)
declare -A PASSWORDS=(
  [admin]="${SMOKE_ADMIN_PASSWORD:-Beacon!Admin2026}" [pmo]="${SMOKE_PMO_PASSWORD:-Beacon!Pmo2026}"
  [pm]="${SMOKE_PM_PASSWORD:-Beacon!Pm2026x}" [analyst]="${SMOKE_ANALYST_PASSWORD:-Beacon!Analyst2026}"
  [exec]="${SMOKE_EXEC_PASSWORD:-Beacon!Exec2026}")
declare -A TOKENS=()

# request METHOD PATH [TOKEN] [JSON_BODY] -> prints "STATUS BODY"
request() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  local args=(-s -m 35 -o /tmp/smoke.$$ -w '%{http_code}' -X "$method" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(--data "$body")
  local status
  status=$(curl "${args[@]}" "$BASE_URL$path")
  echo "$status $(cat /tmp/smoke.$$ 2>/dev/null)"
  rm -f /tmp/smoke.$$
}

check() {  # check DESCRIPTION EXPECTED_STATUS ACTUAL_STATUS
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  ✓ %-58s %s\n' "$1" "$3"
  else FAIL=$((FAIL + 1)); printf '  ✗ %-58s expected %s got %s\n' "$1" "$2" "$3"; fi
}

echo "Beacon smoke test against $BASE_URL"
echo "-- warm-up (Aurora may be resuming from auto-pause)"
for attempt in 1 2 3; do
  read -r status _ <<< "$(request GET /api/projects)"
  [ "$status" = "401" ] && break
  echo "  warm-up attempt $attempt: $status"; sleep 5
done
check "unauthenticated portfolio request is rejected" 401 "$status"

echo "-- sign in as every role"
for role in admin pmo pm analyst exec; do
  body=$(jq -nc --arg e "${EMAILS[$role]}" --arg p "${PASSWORDS[$role]}" '{email:$e,password:$p}')
  read -r status json <<< "$(request POST /api/auth/login '' "$body")"
  check "sign in as $role" 200 "$status"
  TOKENS[$role]=$(echo "$json" | jq -r '.token // empty')
done

body=$(jq -nc '{email:"admin@acme.example",password:"Wrong!Password1"}')
read -r status json <<< "$(request POST /api/auth/login '' "$body")"
check "wrong password gives generic 401" 401 "$status"
check "error has standard shape" true "$(echo "$json" | jq -r '(.error.code != null) and (.error.message != null) and (.error.details != null)' 2>/dev/null)"

echo "-- session"
read -r status json <<< "$(request GET /api/auth/me "${TOKENS[pm]}")"
check "pm GET /api/auth/me" 200 "$status"
read -r status _ <<< "$(request POST /api/auth/refresh "${TOKENS[exec]}")"
check "exec renews session" 200 "$status"

echo "-- portfolio (role-based access)"
declare -A EXPECT_PROJECTS=([admin]=200 [pmo]=200 [pm]=200 [analyst]=200 [exec]=200)
for role in admin pmo pm analyst exec; do
  read -r status json <<< "$(request GET '/api/projects?page_size=5' "${TOKENS[$role]}")"
  check "$role GET /api/projects" "${EXPECT_PROJECTS[$role]}" "$status"
done
read -r status json <<< "$(request GET '/api/projects?q=Customer%20Portal%20Rebuild' "${TOKENS[exec]}")"
check "search finds the story project" "Customer Portal Rebuild" "$(echo "$json" | jq -r '.items[0].name')"
read -r status json <<< "$(request GET '/api/projects?page_size=1' "${TOKENS[pmo]}")"
check "portfolio total (seeded)" 120 "$(echo "$json" | jq -r '.total')"
project_id=$(echo "$json" | jq -r '.items[0].id')
read -r status _ <<< "$(request GET "/api/projects/$project_id" "${TOKENS[exec]}")"
check "exec GET project detail" 200 "$status"
read -r status _ <<< "$(request GET /api/projects/lookups "${TOKENS[pm]}")"
check "pm GET lookups" 200 "$status"
read -r status _ <<< "$(request GET '/api/projects?lifecycle_status=NOPE' "${TOKENS[pmo]}")"
check "invalid filter is 400" 400 "$status"

echo "-- user management (Admin only)"
declare -A EXPECT_USERS=([admin]=200 [pmo]=403 [pm]=403 [analyst]=403 [exec]=403)
for role in admin pmo pm analyst exec; do
  read -r status _ <<< "$(request GET /api/users "${TOKENS[$role]}")"
  check "$role GET /api/users" "${EXPECT_USERS[$role]}" "$status"
done
body=$(jq -nc '{email:"smoke@acme.example",display_name:"Smoke",role:"ADMIN"}')
read -r status _ <<< "$(request POST /api/users "${TOKENS[exec]}" "$body")"
check "exec cannot create an Admin (privilege escalation)" 403 "$status"

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

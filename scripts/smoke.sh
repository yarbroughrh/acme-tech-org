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
declare -A EXPECT_PROJECTS=([admin]=403 [pmo]=200 [pm]=200 [analyst]=200 [exec]=200)
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

echo "-- change requests (PM Analyst proposals, PM approvals)"
read -r status json <<< "$(request GET '/api/change-requests?view=approvals&status=PENDING' "${TOKENS[pm]}")"
check "pm sees approvals waiting" 200 "$status"
check "seeded proposals are pending for the demo PM" true "$(echo "$json" | jq -r '.total >= 1')"
read -r status json <<< "$(request GET '/api/change-requests?view=mine' "${TOKENS[analyst]}")"
check "analyst sees own proposals" 200 "$status"
read -r status _ <<< "$(request GET /api/change-requests "${TOKENS[exec]}")"
check "exec cannot read change requests" 403 "$status"
read -r status json <<< "$(request GET '/api/projects?q=Customer%20Portal%20Rebuild' "${TOKENS[pm]}")"
cpr=$(echo "$json" | jq -r '.items[0].id')
check "story project is Red with Status mismatch" "RED STATUS_MISMATCH" "$(echo "$json" | jq -r '.items[0] | "\(.health_overall) \(.flags | join(","))"')"
read -r status json <<< "$(request GET "/api/projects/$cpr" "${TOKENS[analyst]}")"
check "assigned analyst can view the project" 200 "$status"
check "analyst may propose but not edit" "true false" "$(echo "$json" | jq -r '"\(.project.permissions.can_propose) \(.project.permissions.can_edit_plan)"')"
read -r status _ <<< "$(request POST "/api/projects/$cpr/milestones" "${TOKENS[analyst]}" '{"name":"x","due_date":"2026-12-01","status":"NOT_STARTED"}')"
check "analyst direct edit is 403" 403 "$status"

echo "-- lead decisions"
read -r status _ <<< "$(request GET /api/users/audit "${TOKENS[admin]}")"
check "admin reads the access audit" 200 "$status"
read -r status _ <<< "$(request GET /api/projects/lookups "${TOKENS[admin]}")"
check "admin has no project data (lookups)" 403 "$status"
read -r status json <<< "$(request GET '/api/projects?q=HR%20Self-Service%20Portal' "${TOKENS[pm]}")"
hr=$(echo "$json" | jq -r '.items[0].id'); hv=$(echo "$json" | jq -r '.items[0].version')
read -r status _ <<< "$(request PUT "/api/projects/$hr" "${TOKENS[pm]}" "{\"lifecycle_status\":\"ON_HOLD\",\"version\":$hv}")"
check "pm cannot change lifecycle status" 403 "$status"
read -r status _ <<< "$(request PUT "/api/projects/$hr" "${TOKENS[pm]}" "{\"approved_budget\":1,\"rebaseline_reason\":\"x\",\"version\":$hv}")"
check "pm cannot rebaseline" 403 "$status"
read -r status _ <<< "$(request GET "/api/projects/00000000-0000-4000-8000-000000000000" "${TOKENS[pm]}")"
check "unknown project is a JSON 404 (not masked by CloudFront)" 404 "$status"

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

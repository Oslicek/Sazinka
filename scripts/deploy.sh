#!/usr/bin/env bash
#
# Push to master and optionally trigger production deploy.
#
# Usage:
#   ./scripts/deploy.sh              # push only (CI runs, no deploy)
#   ./scripts/deploy.sh --deploy     # push + wait for CI + deploy all to production
#   ./scripts/deploy.sh --deploy app # push + deploy app only
#   ./scripts/deploy.sh --deploy site
#   ./scripts/deploy.sh --deploy worker
#
# Prerequisites:
#   - GITHUB_TOKEN env var (or ~/.config/deploy-token) with repo + workflow scope
#   - git remote "origin" pointing to github.com/Oslicek/Sazinka
#   - curl, jq

set -euo pipefail

REPO="Oslicek/Sazinka"
DEPLOY_WORKFLOW="deploy.yml"
CI_WORKFLOW="ci.yml"
TARGET="production"
POLL_INTERVAL=30
MAX_WAIT=1800  # 30 minutes

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

resolve_token() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    return
  fi
  local token_file="$HOME/.config/deploy-token"
  if [ -f "$token_file" ]; then
    GITHUB_TOKEN=$(< "$token_file")
    export GITHUB_TOKEN
    return
  fi
  echo -e "${RED}Error: GITHUB_TOKEN not set and ~/.config/deploy-token not found.${NC}"
  echo "Create a GitHub PAT with 'repo' and 'workflow' scopes, then either:"
  echo "  export GITHUB_TOKEN=ghp_..."
  echo "  echo 'ghp_...' > ~/.config/deploy-token && chmod 600 ~/.config/deploy-token"
  exit 1
}

github_api() {
  local method="$1" endpoint="$2"
  shift 2
  curl -sf -X "$method" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com$endpoint" "$@"
}

push_to_origin() {
  echo -e "${CYAN}Pushing to origin/master...${NC}"
  git push origin HEAD:master
  SHA=$(git rev-parse HEAD)
  SHORT_SHA=$(git rev-parse --short HEAD)
  echo -e "${GREEN}Pushed ${SHORT_SHA}${NC}"
}

wait_for_ci() {
  echo -e "${CYAN}Waiting for CI to complete for ${SHORT_SHA}...${NC}"
  local waited=0

  # Wait for the CI run to appear
  local run_id=""
  while [ -z "$run_id" ] && [ $waited -lt 120 ]; do
    sleep 10
    waited=$((waited + 10))
    run_id=$(github_api GET "/repos/$REPO/actions/workflows/$CI_WORKFLOW/runs?head_sha=$SHA&per_page=1" \
      | jq -r '.workflow_runs[0].id // empty' 2>/dev/null || true)
  done

  if [ -z "$run_id" ]; then
    echo -e "${YELLOW}No CI run found for ${SHORT_SHA} (no watched paths changed?). Proceeding with deploy.${NC}"
    return 0
  fi

  echo -e "  CI run: https://github.com/$REPO/actions/runs/$run_id"

  # Poll until completed
  while [ $waited -lt $MAX_WAIT ]; do
    local status conclusion
    local run_json
    run_json=$(github_api GET "/repos/$REPO/actions/runs/$run_id")
    status=$(echo "$run_json" | jq -r '.status')
    conclusion=$(echo "$run_json" | jq -r '.conclusion // empty')

    if [ "$status" = "completed" ]; then
      if [ "$conclusion" = "success" ]; then
        echo -e "${GREEN}CI passed ✓${NC}"
        return 0
      else
        echo -e "${RED}CI failed: $conclusion${NC}"
        echo "  https://github.com/$REPO/actions/runs/$run_id"
        exit 1
      fi
    fi

    printf "  %-50s [%ds]\r" "Status: $status..." "$waited"
    sleep $POLL_INTERVAL
    waited=$((waited + POLL_INTERVAL))
  done

  echo -e "${RED}CI timed out after ${MAX_WAIT}s${NC}"
  exit 1
}

trigger_deploy() {
  local components="$1"
  echo -e "${CYAN}Triggering deploy: target=${TARGET}, components=${components}, ref=${SHORT_SHA}${NC}"

  github_api POST "/repos/$REPO/actions/workflows/$DEPLOY_WORKFLOW/dispatches" \
    -d "{\"ref\":\"master\",\"inputs\":{\"target\":\"$TARGET\",\"components\":\"$components\",\"git_ref\":\"$SHA\"}}"

  echo -e "${GREEN}Deploy triggered ✓${NC}"

  # Wait a moment for the run to appear, then print the URL
  sleep 5
  local deploy_url
  deploy_url=$(github_api GET "/repos/$REPO/actions/workflows/$DEPLOY_WORKFLOW/runs?per_page=1" \
    | jq -r '.workflow_runs[0].html_url // empty' 2>/dev/null || true)
  if [ -n "$deploy_url" ]; then
    echo -e "  ${CYAN}${deploy_url}${NC}"
  fi
}

# ── Main ──

DEPLOY=false
COMPONENTS="all"

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy)
      DEPLOY=true
      if [ "${2:-}" = "worker" ] || [ "${2:-}" = "site" ] || [ "${2:-}" = "app" ] || [ "${2:-}" = "all" ]; then
        COMPONENTS="$2"
        shift
      fi
      ;;
    --staging)
      TARGET="staging"
      ;;
    --help|-h)
      echo "Usage: $0 [--deploy [worker|site|app|all]] [--staging]"
      echo ""
      echo "Without --deploy: push to master (CI runs automatically)"
      echo "With --deploy:    push, wait for CI, trigger production deploy"
      echo "With --staging:   deploy to staging instead of production"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

push_to_origin

if [ "$DEPLOY" = true ]; then
  resolve_token
  wait_for_ci
  trigger_deploy "$COMPONENTS"
  echo ""
  echo -e "${GREEN}Done. Push + CI + deploy triggered for ${SHORT_SHA}.${NC}"
else
  echo -e "${YELLOW}Push only — no deploy. Use --deploy to also deploy.${NC}"
fi

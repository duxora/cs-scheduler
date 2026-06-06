#!/usr/bin/env bash
# poll/drivers/ci-checks.sh — single CI-check probe for a GitHub PR.
#
# Fixes the "statusCheckRollup returns empty" eventual-consistency bug by
# never trusting the GraphQL aggregate. Three-tier resolution:
#
#   Tier 1: `gh pr checks <PR> --json name,state,bucket`
#           Different code path than `gh pr view --json statusCheckRollup`;
#           usually populated when the rollup is still empty.
#
#   Tier 2: REST commit-level APIs, union of two endpoints — these are
#           authoritative and have no aggregation race:
#             GET /repos/{o}/{r}/commits/{sha}/check-runs   (Actions, etc.)
#             GET /repos/{o}/{r}/commits/{sha}/status       (legacy statuses)
#
#   Tier 3: Empty-grace classification. If both tiers return empty:
#             - PR < $EMPTY_GRACE_SEC old  → state=pending (CI not registered yet)
#             - older                      → state=unknown (caller decides)
#
# Force-push handling: head SHA is re-resolved on every probe (cheap, one API
# call) so a stale cached SHA can't mask a force-push.
#
# Usage:
#   ci-checks.sh <pr_number> [--repo OWNER/REPO]
#
# Output (single line):
#   state=<green|red|pending|unknown>\tsummary=<msg>

set -euo pipefail

PR=""
REPO=""
EMPTY_GRACE_SEC="${EMPTY_GRACE_SEC:-90}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    *) PR="$1"; shift ;;
  esac
done

if [ -z "$PR" ]; then
  echo "state=unknown	summary=bad-args:no-pr-number" >&2
  echo "state=unknown	summary=bad-args:no-pr-number"
  exit 0
fi

command -v gh >/dev/null 2>&1 || { echo "state=unknown	summary=gh-missing"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "state=unknown	summary=jq-missing"; exit 0; }

if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
  [ -n "$REPO" ] || { echo "state=unknown	summary=cannot-detect-repo"; exit 0; }
fi

# Single PR fetch: head SHA + created_at + mergeable + state
PR_META=$(gh pr view "$PR" --repo "$REPO" \
  --json headRefOid,createdAt,state,mergeable,mergeStateStatus 2>/dev/null || true)
if [ -z "$PR_META" ]; then
  echo "state=unknown	summary=pr-fetch-failed"
  exit 0
fi

PR_STATE=$(printf '%s' "$PR_META" | jq -r '.state // ""')
SHA=$(printf '%s' "$PR_META" | jq -r '.headRefOid // ""')
CREATED=$(printf '%s' "$PR_META" | jq -r '.createdAt // ""')
MERGEABLE=$(printf '%s' "$PR_META" | jq -r '.mergeable // ""')

# Closed/merged → terminal. (Caller may treat this as success; we report green.)
if [ "$PR_STATE" = "MERGED" ]; then
  echo "state=green	summary=pr-merged"; exit 0
fi
if [ "$PR_STATE" = "CLOSED" ]; then
  echo "state=red	summary=pr-closed"; exit 0
fi

# Hard merge blockers other than CI
if [ "$MERGEABLE" = "CONFLICTING" ]; then
  echo "state=red	summary=merge-conflicts"; exit 0
fi

# Compute elapsed since PR creation (for grace window)
CREATED_EPOCH=0
if [ -n "$CREATED" ]; then
  CREATED_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$CREATED" +%s 2>/dev/null || \
                  date -d "$CREATED" +%s 2>/dev/null || echo 0)
fi
NOW=$(date +%s)
ELAPSED=$((NOW - CREATED_EPOCH))

classify_buckets() {
  # Reads JSON array of {state|status, conclusion|bucket} from stdin.
  # Emits "pending=N failed=N passed=N total=N"
  jq -r '
    def norm:
      (.bucket // .conclusion // .state // .status // "") | ascii_downcase;
    def is_pending(s):
      s == "" or s == "pending" or s == "queued" or s == "in_progress" or s == "waiting" or s == "requested";
    def is_failed(s):
      s == "fail" or s == "failure" or s == "error" or s == "timed_out" or s == "cancelled" or s == "action_required" or s == "stale";
    def is_passed(s):
      # gh pr checks bucket uses "skipping" (not "skipped") for SKIPPED checks
      s == "pass" or s == "success" or s == "neutral" or s == "skipped" or s == "skipping";
    reduce .[] as $c (
      {p:0,f:0,s:0,t:0};
      .t += 1
      | ($c | norm) as $n
      | if is_failed($n) then .f += 1
        elif is_passed($n) then .s += 1
        elif is_pending($n) then .p += 1
        else .p += 1 end
    )
    | "pending=\(.p) failed=\(.f) passed=\(.s) total=\(.t)"
  '
}

# ---- Tier 1: gh pr checks ----
T1=$(gh pr checks "$PR" --repo "$REPO" --json name,state,bucket 2>/dev/null || echo "[]")
T1_COUNT=$(printf '%s' "$T1" | jq 'length' 2>/dev/null || echo 0)

if [ "$T1_COUNT" -gt 0 ]; then
  STATS=$(printf '%s' "$T1" | classify_buckets)
  eval "$STATS"
  if [ "${failed:-0}" -gt 0 ] && [ "${pending:-0}" -eq 0 ]; then
    echo "state=red	summary=tier1:failed=$failed/total=$total"; exit 0
  fi
  if [ "${pending:-0}" -eq 0 ] && [ "${passed:-0}" -gt 0 ]; then
    echo "state=green	summary=tier1:passed=$passed/total=$total"; exit 0
  fi
  echo "state=pending	summary=tier1:pending=$pending/failed=$failed/passed=$passed/total=$total"
  exit 0
fi

# ---- Tier 2: REST commit-level APIs ----
if [ -n "$SHA" ]; then
  # NB: avoid --paginate here. With --jq it emits one JSON array per page and
  # the concatenation `[...][...]` is invalid JSON. Default page size is 30,
  # which covers virtually every real PR. If a PR somehow has >30 check-runs,
  # accept the truncation: any failing run in the first page is sufficient to
  # report red.
  CR=$(gh api "repos/$REPO/commits/$SHA/check-runs?per_page=100" \
       --jq '[.check_runs[]? | {state:.status, conclusion:.conclusion}]' 2>/dev/null || echo "[]")
  ST=$(gh api "repos/$REPO/commits/$SHA/status" \
       --jq '[.statuses[]? | {state:.state}]' 2>/dev/null || echo "[]")
  UNION=$(jq -n --argjson a "$CR" --argjson b "$ST" '$a + $b')
  U_COUNT=$(printf '%s' "$UNION" | jq 'length')

  if [ "$U_COUNT" -gt 0 ]; then
    STATS=$(printf '%s' "$UNION" | classify_buckets)
    eval "$STATS"
    if [ "${failed:-0}" -gt 0 ] && [ "${pending:-0}" -eq 0 ]; then
      echo "state=red	summary=tier2:failed=$failed/total=$total"; exit 0
    fi
    if [ "${pending:-0}" -eq 0 ] && [ "${passed:-0}" -gt 0 ]; then
      echo "state=green	summary=tier2:passed=$passed/total=$total"; exit 0
    fi
    echo "state=pending	summary=tier2:pending=$pending/failed=$failed/passed=$passed/total=$total"
    exit 0
  fi
fi

# ---- Tier 3: empty-grace classification ----
if [ "$ELAPSED" -lt "$EMPTY_GRACE_SEC" ]; then
  echo "state=pending	summary=grace:no-checks-yet:elapsed=${ELAPSED}s"
  exit 0
fi

echo "state=unknown	summary=no-checks-after-grace:elapsed=${ELAPSED}s"

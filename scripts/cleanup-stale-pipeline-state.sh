#!/bin/bash
# One-shot cleanup for legacy /tmp/claude-workflow-*.json orphans.
# The live reconciler in /api/pipeline-state now keeps this state in sync.
set -euo pipefail

DB="$HOME/.backlog/backlog.db"
done_count=0
active_count=0
untouched_count=0

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

if [ ! -f "$DB" ]; then
  echo "cleaned: 0 done, kept: 0 active, untouched: 0"
  exit 0
fi

shopt -s nullglob
state_files=(/tmp/claude-workflow-*.json)
shopt -u nullglob

for state_file in "${state_files[@]}"; do
  [ -f "$state_file" ] || continue

  task_id=$(jq -r '.claimed_tkt // empty' "$state_file" 2>/dev/null || true)
  session_id=$(jq -r '.session_id // empty' "$state_file" 2>/dev/null || true)
  if [ -z "$task_id" ] || [ -z "$session_id" ]; then
    untouched_count=$((untouched_count + 1))
    continue
  fi

  row=$(sqlite3 "$DB" "SELECT COALESCE(status,''), COALESCE(completed_at,'') FROM tasks WHERE id = $task_id LIMIT 1;" 2>/dev/null || true)
  if [ -z "$row" ]; then
    untouched_count=$((untouched_count + 1))
    continue
  fi

  status=$(printf '%s' "$row" | awk -F'|' '{print $1}')
  completed_at=$(printf '%s' "$row" | awk -F'|' '{print $2}')

  if [ "$status" != "done" ]; then
    active_count=$((active_count + 1))
    continue
  fi

  exists=$(sqlite3 "$DB" "SELECT 1 FROM pipeline_runs WHERE session_id = '$(sql_escape "$session_id")' LIMIT 1;" 2>/dev/null || true)
  if [ -z "$exists" ]; then
    read -r pipeline size domain started_at tokens_at_claim steps_json tokens_at_completion duration_s tokens_consumed <<EOF
$(python3 - "$state_file" "$completed_at" <<'PY'
import datetime as dt
import json
import sys

state_path = sys.argv[1]
completed_at = sys.argv[2]
with open(state_path) as f:
    state = json.load(f)

steps = state.get("steps") or {}
final_step = None
if isinstance(steps, dict) and steps:
    final_step = list(steps.values())[-1]

tokens_at_completion = 0
if isinstance(final_step, dict) and final_step.get("tokens_at_completion") is not None:
    try:
        tokens_at_completion = int(final_step["tokens_at_completion"])
    except (TypeError, ValueError):
        tokens_at_completion = 0

tokens_at_claim = state.get("tokens_at_claim") or 0
try:
    tokens_at_claim = int(tokens_at_claim)
except (TypeError, ValueError):
    tokens_at_claim = 0

duration_s = 0
started_at = state.get("started_at") or ""
try:
    started = dt.datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
    completed = dt.datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
    duration_s = max(0, int((completed - started).total_seconds()))
except Exception:
    duration_s = 0

tokens_consumed = max(0, tokens_at_completion - tokens_at_claim)

print("\t".join([
    str(state.get("pipeline", "code") or "code"),
    str(state.get("size", "medium") or "medium"),
    str(state.get("ticket_domain", "") or ""),
    str(started_at),
    str(tokens_at_claim),
    json.dumps(steps, separators=(",", ":")),
    str(tokens_at_completion),
    str(duration_s),
    str(tokens_consumed),
]))
PY
)
EOF

    pipeline_esc=$(sql_escape "$pipeline")
    size_esc=$(sql_escape "$size")
    domain_esc=$(sql_escape "$domain")
    started_at_esc=$(sql_escape "$started_at")
    completed_at_esc=$(sql_escape "$completed_at")
    steps_esc=$(sql_escape "$steps_json")
    tokens_consumed=${tokens_consumed:-0}

    sqlite3 "$DB" "
      INSERT INTO pipeline_runs
        (task_id, session_id, pipeline, size, domain, started_at, completed_at, duration_s, steps, tokens_at_claim, tokens_consumed)
      SELECT
        $task_id,
        '$(sql_escape "$session_id")',
        '$pipeline_esc',
        '$size_esc',
        '$domain_esc',
        '$started_at_esc',
        '$completed_at_esc',
        $duration_s,
        '$steps_esc',
        $tokens_at_claim,
        $tokens_consumed
      WHERE NOT EXISTS (
        SELECT 1 FROM pipeline_runs WHERE session_id = '$(sql_escape "$session_id")'
      );
    " 2>/dev/null || true
  fi

  rm -f "$state_file"
  sqlite3 "$DB" "DELETE FROM claims WHERE session_id = '$(sql_escape "$session_id")';" 2>/dev/null || true
  done_count=$((done_count + 1))
done

echo "cleaned: $done_count done, kept: $active_count active, untouched: $untouched_count"

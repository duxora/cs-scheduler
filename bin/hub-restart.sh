#!/usr/bin/env bash
# Restart the automation-hub uvicorn server so a merged backend change actually
# reaches the running process. Bare `uvicorn --reload`-less deploys never pick
# up code changes on their own; nothing else restarts this process today.
#
# Safety: this script only ever signals a process it has verified is THIS
# repo's uvicorn (by inspecting its command line), never just "whatever is on
# the port". Refuses otherwise.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7070}"
HOST="${HOST:-0.0.0.0}"
HEALTH_HOST="${HEALTH_HOST:-localhost}"
PYTHON_BIN="${HUB_PYTHON_BIN:-/Users/ducduong/.pyenv/versions/3.12.3/bin/python}"
LOG_DIR="${HUB_LOG_DIR:-$REPO_ROOT/logs}"
LOG_FILE="$LOG_DIR/hub-restart.log"
STOP_WAIT_SECS="${HUB_STOP_WAIT_SECS:-10}"
START_WAIT_SECS="${HUB_START_WAIT_SECS:-20}"
HEALTH_PATH="${HUB_HEALTH_PATH:-/workflow/api/roadmap}"

mkdir -p "$LOG_DIR"

log() {
    echo "[hub-restart] $*" | tee -a "$LOG_FILE"
}

log "starting restart (repo=$REPO_ROOT port=$PORT host=$HOST python=$PYTHON_BIN)"
log "logging to $LOG_FILE"

# --- find the listener on PORT, verify it's THIS repo's uvicorn, stop it ---
EXISTING_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n1 || true)"

if [ -n "$EXISTING_PID" ]; then
    CMDLINE="$(ps -o command= -p "$EXISTING_PID" 2>/dev/null || true)"
    log "found listener on port $PORT: pid=$EXISTING_PID cmd=$CMDLINE"

    if [[ "$CMDLINE" != *"uvicorn"* ]] || [[ "$CMDLINE" != *"server.main:app"* ]]; then
        log "REFUSING to kill pid $EXISTING_PID - command line does not look like this repo's" \
            "'uvicorn server.main:app'. Not touching it."
        exit 1
    fi

    log "confirmed pid $EXISTING_PID is this repo's uvicorn; sending SIGTERM"
    kill -TERM "$EXISTING_PID" 2>/dev/null || true

    waited=0
    while kill -0 "$EXISTING_PID" 2>/dev/null; do
        if [ "$waited" -ge "$STOP_WAIT_SECS" ]; then
            log "pid $EXISTING_PID still alive after ${STOP_WAIT_SECS}s, sending SIGKILL"
            kill -KILL "$EXISTING_PID" 2>/dev/null || true
            sleep 1
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done

    if kill -0 "$EXISTING_PID" 2>/dev/null; then
        log "ERROR: pid $EXISTING_PID did not die even after SIGKILL"
        exit 1
    fi
    log "old process (pid $EXISTING_PID) stopped via $([ "$waited" -ge "$STOP_WAIT_SECS" ] && echo SIGKILL || echo SIGTERM)"
else
    log "no existing listener on port $PORT; nothing to stop"
fi

# --- start fresh from the repo ---
cd "$REPO_ROOT"
log "starting: $PYTHON_BIN -m uvicorn server.main:app --host $HOST --port $PORT"
nohup "$PYTHON_BIN" -m uvicorn server.main:app --host "$HOST" --port "$PORT" \
    >>"$LOG_FILE" 2>&1 &
NEW_PID=$!
disown "$NEW_PID" 2>/dev/null || true
log "new process started: pid=$NEW_PID"

# --- wait for it to actually answer before declaring success ---
HEALTH_URL="http://${HEALTH_HOST}:${PORT}${HEALTH_PATH}"
log "waiting up to ${START_WAIT_SECS}s for $HEALTH_URL to respond"

waited=0
up=0
while [ "$waited" -lt "$START_WAIT_SECS" ]; do
    if ! kill -0 "$NEW_PID" 2>/dev/null; then
        log "ERROR: new process (pid $NEW_PID) died during startup"
        log "--- log tail ---"
        tail -n 50 "$LOG_FILE" | tee -a "$LOG_FILE" >&2
        exit 1
    fi
    if curl -fsS -o /dev/null -m 2 "$HEALTH_URL" 2>/dev/null; then
        up=1
        break
    fi
    sleep 1
    waited=$((waited + 1))
done

if [ "$up" -ne 1 ]; then
    log "ERROR: $HEALTH_URL never responded within ${START_WAIT_SECS}s"
    log "--- log tail ---"
    tail -n 50 "$LOG_FILE" | tee -a "$LOG_FILE" >&2
    exit 1
fi

log "hub is up: pid=$NEW_PID, $HEALTH_URL responded after ${waited}s"
log "restart complete"

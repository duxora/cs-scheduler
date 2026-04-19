"""Dev Workflow — dashboard routes for visualizing the dev-to-deploy pipeline."""
import asyncio
import glob as globmod
import hashlib
import json as jsonlib
import os
import sqlite3
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter(redirect_slashes=True)

# tkt database path
TKT_DB_PATH = Path.home() / ".backlog" / "backlog.db"

# Task type hierarchy (mirrors backlog/src/models/task.ts)
PARENT_TYPES = ("initiative", "epic")


def get_tkt_db() -> Optional[sqlite3.Connection]:
    if not TKT_DB_PATH.exists():
        return None
    conn = sqlite3.connect(str(TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


# ── Hierarchy helpers ────────────────────────────────────────────────────────

def compute_progress(conn: sqlite3.Connection, task_id: int) -> dict:
    """Rollup of descendant leaf-task counts by status.
    Mirrors TaskModel.progress() in backlog/src/models/task.ts — walks the whole
    subtree via recursive CTE but counts only leaf types (containers excluded).
    """
    rows = conn.execute(
        """
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM tasks WHERE parent_id = ?
          UNION ALL
          SELECT t.id FROM tasks t
          JOIN descendants d ON t.parent_id = d.id
        )
        SELECT t.status FROM tasks t
        JOIN descendants d ON t.id = d.id
        WHERE t.type NOT IN ('initiative', 'epic')
        """,
        [task_id],
    ).fetchall()

    total = len(rows)
    done = sum(1 for r in rows if r["status"] == "done")
    in_progress = sum(1 for r in rows if r["status"] == "in_progress")
    open_ = sum(1 for r in rows if r["status"] in ("open", "backlog"))
    percent = 0 if total == 0 else round((done / total) * 100)
    return {
        "total": total,
        "done": done,
        "in_progress": in_progress,
        "open": open_,
        "percent": percent,
    }


def count_children(conn: sqlite3.Connection, task_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM tasks WHERE parent_id = ?", [task_id]
    ).fetchone()
    return row["c"] if row else 0


def list_ancestors(conn: sqlite3.Connection, task_id: int) -> list[dict]:
    """Walk up parent chain. Returns [immediate_parent, grandparent, ...]."""
    chain: list[dict] = []
    seen: set[int] = set()
    current_id = task_id
    while True:
        row = conn.execute(
            """
            SELECT t.id, t.parent_id, t.title, t.type, t.status, t.priority, t.project_id, t.slug
            FROM tasks t WHERE t.id = ?
            """,
            [current_id],
        ).fetchone()
        if not row or row["parent_id"] is None or row["parent_id"] in seen:
            break
        seen.add(row["parent_id"])
        parent = conn.execute(
            """
            SELECT t.id, t.parent_id, t.title, t.type, t.status, t.priority, t.project_id, t.slug
            FROM tasks t WHERE t.id = ?
            """,
            [row["parent_id"]],
        ).fetchone()
        if not parent:
            break
        chain.append(dict(parent))
        current_id = parent["id"]
    return chain


def build_tree_node(conn: sqlite3.Connection, task_id: int) -> Optional[dict]:
    """Recursive hierarchy — mirrors buildTree() in backlog/src/mcp/server.ts."""
    root = conn.execute(
        """
        SELECT t.id, t.parent_id, t.title, t.type, t.status, t.priority,
               t.domain, t.project_id, p.name AS project_name, t.slug,
               t.created_at, t.updated_at, t.completed_at, t.due_date
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        WHERE t.id = ?
        """,
        [task_id],
    ).fetchone()
    if not root:
        return None

    node = dict(root)
    node["children"] = []
    if node["type"] in PARENT_TYPES:
        node["progress"] = compute_progress(conn, task_id)
        node["children_count"] = count_children(conn, task_id)
        children = conn.execute(
            "SELECT id FROM tasks WHERE parent_id = ? ORDER BY created_at ASC",
            [task_id],
        ).fetchall()
        for child in children:
            child_node = build_tree_node(conn, child["id"])
            if child_node:
                node["children"].append(child_node)
    return node


# ── Dashboard page (now served by React SPA at frontend/dist/) ───────────────


# ── JSON API ─────────────────────────────────────────────────────────────────

@router.get("/api/tasks", response_class=JSONResponse)
async def api_tasks(
    status: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    phase: Optional[str] = Query(None),
):
    conn = get_tkt_db()
    if not conn:
        return JSONResponse([], status_code=200)

    conditions = []
    params = []

    if status:
        placeholders = ",".join("?" for _ in status.split(","))
        conditions.append(f"t.status IN ({placeholders})")
        params.extend(status.split(","))
    if project:
        conditions.append("t.project_id = ?")
        params.append(project)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    rows = conn.execute(f"""
        SELECT t.id, t.project_id, p.name as project_name,
               t.title, t.type, t.priority, t.status,
               t.domain, t.pr_number, t.branch, t.parent_id,
               t.context, p.context AS project_context, t.slug,
               t.created_at, t.updated_at, t.completed_at, t.due_date
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        {where}
        ORDER BY t.created_at DESC
        LIMIT 200
    """, params).fetchall()

    tasks = []
    for r in rows:
        task = dict(r)
        task["phase"] = _detect_phase(r)
        if phase and task["phase"] != phase:
            continue
        if task["type"] in PARENT_TYPES:
            task["children_count"] = count_children(conn, task["id"])
            task["progress"] = compute_progress(conn, task["id"])
        tasks.append(task)

    conn.close()
    return JSONResponse(tasks)


@router.get("/api/dashboard", response_class=JSONResponse)
async def api_dashboard():
    conn = get_tkt_db()
    if not conn:
        return JSONResponse([])

    rows = conn.execute("""
        SELECT p.id as project_id, p.name as project_name, p.context,
               SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) as open_count,
               SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
               SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_count
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.archived_at IS NULL
        GROUP BY p.id
    """).fetchall()

    conn.close()
    return JSONResponse([dict(r) for r in rows])


@router.get("/api/projects-insights", response_class=JSONResponse)
async def api_projects_insights():
    """Per-project insights for the Projects tab.

    Extends /api/dashboard with PM-oriented signals: WIP, stale open tasks,
    done-velocity (14d), active epic count, last-activity timestamp.
    """
    conn = get_tkt_db()
    if not conn:
        return JSONResponse([])

    rows = conn.execute(
        """
        SELECT p.id          AS project_id,
               p.name        AS project_name,
               p.context     AS context,
               p.priority    AS priority,
               p.mode        AS mode,
               p.repo_path   AS repo_path,
               p.archived_at AS archived_at,
               SUM(CASE WHEN t.status = 'open'        THEN 1 ELSE 0 END) AS open_count,
               SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
               SUM(CASE WHEN t.status = 'backlog'     THEN 1 ELSE 0 END) AS backlog_count,
               SUM(CASE WHEN t.status = 'done'        THEN 1 ELSE 0 END) AS done_count,
               SUM(CASE WHEN t.type IN ('initiative','epic')
                         AND t.status NOT IN ('done','cancelled','deferred')
                        THEN 1 ELSE 0 END)                                AS active_epic_count,
               SUM(CASE WHEN t.status = 'open'
                         AND t.created_at < datetime('now', '-14 days')
                        THEN 1 ELSE 0 END)                                AS stale_count,
               SUM(CASE WHEN t.status = 'done'
                         AND t.completed_at >= datetime('now', '-14 days')
                        THEN 1 ELSE 0 END)                                AS done_14d,
               SUM(CASE WHEN t.due_date IS NOT NULL
                         AND t.due_date < date('now')
                         AND t.status NOT IN ('done','cancelled','deferred')
                        THEN 1 ELSE 0 END)                                AS overdue_count,
               SUM(CASE WHEN t.priority = 'critical'
                         AND t.status IN ('open','in_progress','backlog')
                        THEN 1 ELSE 0 END)                                AS critical_count,
               SUM(CASE WHEN t.priority = 'high'
                         AND t.status IN ('open','in_progress','backlog')
                        THEN 1 ELSE 0 END)                                AS high_count,
               (SELECT t2.priority FROM tasks t2
                 WHERE t2.project_id = p.id
                   AND t2.status IN ('open','in_progress','backlog')
                 ORDER BY CASE t2.priority
                     WHEN 'critical' THEN 0
                     WHEN 'high' THEN 1
                     WHEN 'medium' THEN 2
                     WHEN 'low' THEN 3
                     ELSE 4
                   END
                 LIMIT 1)                                                 AS top_priority,
               MAX(t.updated_at)                                          AS last_activity
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.archived_at IS NULL
        GROUP BY p.id
        ORDER BY p.name
        """
    ).fetchall()

    conn.close()
    return JSONResponse([dict(r) for r in rows])


VALID_CONTEXTS = {"work", "family", "personal"}
VALID_PRIORITIES = {"critical", "high", "medium", "low"}
VALID_MODES = {"solo", "team"}


@router.get("/api/projects/{project_id}", response_class=JSONResponse)
async def api_get_project(project_id: str):
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)
    row = conn.execute(
        "SELECT id, name, repo_path, context, priority, mode, created_at, archived_at "
        "FROM projects WHERE id = ?",
        [project_id],
    ).fetchone()
    conn.close()
    if not row:
        return JSONResponse({"error": "project not found"}, status_code=404)
    return JSONResponse(dict(row))


@router.put("/api/projects/{project_id}", response_class=JSONResponse)
async def api_update_project(project_id: str, request: Request):
    body = await request.json()

    sets: list[str] = []
    params: list = []

    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            return JSONResponse({"error": "name cannot be empty"}, status_code=400)
        sets.append("name = ?"); params.append(name)

    if "repo_path" in body:
        rp = body.get("repo_path")
        rp = rp.strip() if isinstance(rp, str) else rp
        sets.append("repo_path = ?"); params.append(rp or None)

    if "context" in body:
        ctx = body.get("context") or None
        if ctx is not None and ctx not in VALID_CONTEXTS:
            return JSONResponse({"error": f"invalid context, must be one of {sorted(VALID_CONTEXTS)} or null"}, status_code=400)
        sets.append("context = ?"); params.append(ctx)

    if "priority" in body:
        pri = body.get("priority") or None
        if pri is not None and pri not in VALID_PRIORITIES:
            return JSONResponse({"error": f"invalid priority, must be one of {sorted(VALID_PRIORITIES)} or null"}, status_code=400)
        sets.append("priority = ?"); params.append(pri)

    if "mode" in body:
        mode = body.get("mode") or None
        if mode is not None and mode not in VALID_MODES:
            return JSONResponse({"error": f"invalid mode, must be one of {sorted(VALID_MODES)} or null"}, status_code=400)
        sets.append("mode = ?"); params.append(mode)

    if not sets:
        return JSONResponse({"error": "no editable fields provided"}, status_code=400)

    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    existing = conn.execute("SELECT id FROM projects WHERE id = ?", [project_id]).fetchone()
    if not existing:
        conn.close()
        return JSONResponse({"error": "project not found"}, status_code=404)

    conn.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = ?", [*params, project_id])
    conn.commit()

    row = conn.execute(
        "SELECT id, name, repo_path, context, priority, mode, created_at, archived_at "
        "FROM projects WHERE id = ?",
        [project_id],
    ).fetchone()
    conn.close()
    return JSONResponse(dict(row))


@router.get("/api/roadmap", response_class=JSONResponse)
async def api_roadmap(
    project: Optional[str] = Query(None),
    include_done: bool = Query(False),
):
    """Initiatives + epics with progress rollup. Mirrors the MCP tkt_roadmap tool.

    By default, only returns active items (excludes done/cancelled/deferred).
    Pass `include_done=true` to get the full list.
    """
    conn = get_tkt_db()
    if not conn:
        return JSONResponse([])

    conditions = ["t.type IN ('initiative', 'epic')"]
    params: list = []
    if not include_done:
        conditions.append("t.status NOT IN ('done', 'cancelled', 'deferred')")
    if project:
        conditions.append("t.project_id = ?")
        params.append(project)
    where = "WHERE " + " AND ".join(conditions)

    rows = conn.execute(
        f"""
        SELECT t.id, t.project_id, p.name AS project_name,
               t.title, t.type, t.priority, t.status, t.domain, t.parent_id,
               t.context, p.context AS project_context, t.slug,
               t.due_date, t.created_at, t.updated_at, t.completed_at
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        {where}
        ORDER BY
          CASE t.type WHEN 'initiative' THEN 0 WHEN 'epic' THEN 1 ELSE 2 END,
          CASE t.priority
            WHEN 'critical' THEN 0 WHEN 'high' THEN 1
            WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4
          END,
          t.created_at ASC
        """,
        params,
    ).fetchall()

    out = []
    for r in rows:
        item = dict(r)
        item["children_count"] = count_children(conn, item["id"])
        item["progress"] = compute_progress(conn, item["id"])
        out.append(item)

    conn.close()
    return JSONResponse(out)


def _parse_id_or_slug(raw: str, conn: sqlite3.Connection) -> Optional[int]:
    """Parse '{id}' or '{id}-{slug}' → int. Falls back to slug-only lookup if no id prefix."""
    import re
    m = re.match(r"^(\d+)", raw)
    if m:
        return int(m.group(1))
    row = conn.execute("SELECT id FROM tasks WHERE slug = ? LIMIT 1", [raw]).fetchone()
    return row["id"] if row else None


@router.get("/api/tree/{ref}", response_class=JSONResponse)
async def api_tree(ref: str):
    """Recursive subtree. Accepts numeric id or '{id}-{slug}' or bare slug."""
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)
    try:
        task_id = _parse_id_or_slug(ref, conn)
        if task_id is None:
            return JSONResponse({"error": f"Task '{ref}' not found"}, status_code=404)
        node = build_tree_node(conn, task_id)
        if not node:
            return JSONResponse({"error": f"Task #{task_id} not found"}, status_code=404)
        ancestors = list_ancestors(conn, task_id)
        return JSONResponse({"tree": node, "ancestors": ancestors})
    finally:
        conn.close()


# ── Server-Sent Events for real-time updates ───────────────────────────────────

def _get_task_list_hash(project: Optional[str] = None, status: Optional[str] = None) -> str:
    """Compute hash of task list to detect changes."""
    conn = get_tkt_db()
    if not conn:
        return ""

    conditions = []
    params = []

    if status:
        statuses = [s.strip() for s in status.split(",")]
        placeholders = ",".join("?" for _ in statuses)
        conditions.append(f"t.status IN ({placeholders})")
        params.extend(statuses)
    else:
        conditions.append("t.status IN (?, ?, ?)")
        params = ["open", "in_progress", "backlog"]

    if project:
        conditions.append("t.project_id = ?")
        params.append(project)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    rows = conn.execute(f"""
        SELECT t.id, t.updated_at, t.status
        FROM tasks t
        {where}
        ORDER BY t.updated_at DESC
    """, params).fetchall()

    conn.close()

    # Hash the task IDs and their update times to detect any change
    data = "|".join(f"{r['id']}:{r['updated_at']}" for r in rows)
    return hashlib.md5(data.encode()).hexdigest()


def _render_task_row(task: dict) -> str:
    """Render a single task row as HTML fragment for HTMX swap."""
    status_colors = {
        "open": "text-blue-400",
        "in_progress": "text-amber-400",
        "done": "text-green-400"
    }
    prio_colors = {
        "critical": "bg-red-600 text-white",
        "high": "bg-orange-500 text-white",
        "medium": "bg-yellow-600 text-white",
        "low": "bg-gray-600 text-gray-200"
    }

    status_color = status_colors.get(task.get("status"), "text-hub-muted")
    prio_color = prio_colors.get(task.get("priority"), "bg-gray-700 text-gray-300")

    pr_link = ""
    if task.get("pr_number"):
        pr_link = f'<a href="https://github.com/c0x12c-internal/service-insight/pull/{task["pr_number"]}" target="_blank" class="text-[10px] text-hub-accent hover:underline">PR #{task["pr_number"]}</a>'

    domain_badge = f'<span class="text-[10px] text-hub-muted bg-hub-bg px-1.5 py-0.5 rounded">{task.get("domain")}</span>' if task.get("domain") else ""

    return f'''<div class="border-b border-hub-border/50 task-row" data-phase="{task.get('phase', 'backlog')}">
  <div class="px-5 py-3 hover:bg-hub-bg/30 cursor-pointer" onclick="toggleTaskDetail({task['id']}, this)">
    <div class="flex items-start gap-3">
      <input type="checkbox" data-task-id="{task['id']}" onchange="event.stopPropagation(); updateBulkBar()"
        onclick="event.stopPropagation()"
        class="task-checkbox w-3.5 h-3.5 mt-0.5 rounded border-hub-border accent-hub-accent cursor-pointer shrink-0" />
      <span class="text-xs font-mono text-hub-muted mt-0.5 shrink-0">#{task['id']}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <p class="text-sm text-hub-text leading-snug">{task.get('title', '')}</p>
          {'<button onclick="event.stopPropagation(); openSessionModal(' + str(task['id']) + ', \'' + task.get('title', '').replace("'", "\\'") + '\', \'' + task.get('project_id', '') + '\')" class="shrink-0 px-2 py-1 text-[10px] font-medium bg-hub-accent/10 text-hub-accent border border-hub-accent/30 rounded hover:bg-hub-accent/20 cursor-pointer" title="Launch Claude Code session">▶ Claude</button>' if task.get('status') != 'done' else ''}
        </div>
        <div class="flex items-center gap-2 mt-1.5 flex-wrap">
          <span class="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded {prio_color}">{task.get('priority', 'low')}</span>
          <span class="text-[10px] {status_color}">{task.get('status', 'open').replace('_', ' ')}</span>
          <span class="text-[10px] text-hub-muted">{task.get('project_name', '')}</span>
          {domain_badge}
          {pr_link}
        </div>
      </div>
    </div>
  </div>
  <div id="task-detail-{task['id']}" class="hidden bg-hub-bg/50 border-t border-hub-border/30">
    <div class="px-5 py-3 text-xs text-hub-muted">Loading...</div>
  </div>
</div>'''


@router.get("/api/task-updates")
async def task_updates(project: Optional[str] = Query(None), status: Optional[str] = Query(None)):
    """SSE endpoint for real-time task list updates."""

    async def event_generator():
        last_hash = ""
        poll_interval = 2  # seconds

        while True:
            try:
                await asyncio.sleep(poll_interval)

                # Check if task list has changed
                current_hash = _get_task_list_hash(project, status)
                if current_hash == last_hash or not current_hash:
                    continue

                last_hash = current_hash

                # Fetch full task list to send updates
                conn = get_tkt_db()
                if not conn:
                    continue

                conditions = []
                params = []

                if status:
                    statuses = [s.strip() for s in status.split(",")]
                    placeholders = ",".join("?" for _ in statuses)
                    conditions.append(f"t.status IN ({placeholders})")
                    params.extend(statuses)
                else:
                    conditions.append("t.status IN (?, ?, ?)")
                    params = ["open", "in_progress", "backlog"]

                if project:
                    conditions.append("t.project_id = ?")
                    params.append(project)

                where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

                rows = conn.execute(f"""
                    SELECT t.id, t.project_id, p.name as project_name,
                           t.title, t.type, t.priority, t.status,
                           t.domain, t.pr_number, t.branch,
                           t.created_at, t.updated_at, t.completed_at
                    FROM tasks t
                    JOIN projects p ON t.project_id = p.id
                    {where}
                    ORDER BY
                        CASE t.priority
                            WHEN 'critical' THEN 0
                            WHEN 'high' THEN 1
                            WHEN 'medium' THEN 2
                            WHEN 'low' THEN 3
                        END,
                        t.created_at DESC
                    LIMIT 300
                """, params).fetchall()

                conn.close()

                # Render task list
                task_list_html = ""
                for r in rows:
                    task = dict(r)
                    task["phase"] = _detect_phase(task)
                    task_list_html += _render_task_row(task)

                # Send SSE event with task list
                # HTMX expects the HTML directly in the data field
                yield f"event: task-update\n"
                # Escape newlines in HTML for SSE format
                escaped_html = task_list_html.replace("\n", " ")
                yield f"data: {escaped_html}\n\n"

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[ERROR] task-updates: {e}")
                await asyncio.sleep(5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ── Claude Code Sessions ─────────────────────────────────────────────────────

CLAUDE_SESSIONS_DIR = Path.home() / ".claude" / "sessions"

# Liveness thresholds. A session file's PID probe alone is unreliable because
# macOS recycles PIDs within days — old session files keep looking "alive" when
# their original PID now belongs to an unrelated (but possibly also Claude)
# process. Layer heartbeat freshness + file age on top of the PID check.
SESSION_HEARTBEAT_FRESH_S = 300   # 5 min — a recent tkt heartbeat confirms this session is live
SESSION_FRESH_S          = 24 * 3600  # 24h — fallback for sessions without a tkt claim


def _parse_started_at(started) -> Optional[float]:
    """Session files store startedAt as epoch milliseconds (number). Returns
    unix seconds, or None if unparseable."""
    if not started:
        return None
    try:
        v = float(started)
    except (TypeError, ValueError):
        return None
    # Values > 1e12 are epoch milliseconds; otherwise assume seconds
    return v / 1000 if v > 1e12 else v


def _parse_heartbeat(hb: Optional[str]) -> Optional[float]:
    """Parse SQLite heartbeat_at (ISO-8601 UTC, possibly with trailing Z) to unix seconds."""
    if not hb:
        return None
    try:
        dt = datetime.fromisoformat(hb.replace("Z", "+00:00"))
        return dt.timestamp()
    except Exception:
        return None


def _list_sessions(claim_map: Optional[dict] = None) -> list[dict]:
    """List Claude Code sessions, classifying each as alive/stale.

    A session is alive when the PID probe succeeds AND at least one of:
      - a tkt claim heartbeat is within SESSION_HEARTBEAT_FRESH_S
      - the session file itself is younger than SESSION_FRESH_S
    Otherwise it's treated as stale (likely a recycled PID) and reported as
    alive=False so the UI can surface/clean it.
    """
    if not CLAUDE_SESSIONS_DIR.exists():
        return []
    if claim_map is None:
        claim_map = {}

    now = time.time()
    sessions = []
    for f in CLAUDE_SESSIONS_DIR.glob("*.json"):
        try:
            data = jsonlib.loads(f.read_text())
        except Exception:
            continue

        pid = data.get("pid")
        session_id = data.get("sessionId", "")
        started_at = data.get("startedAt", "")
        started_s = _parse_started_at(started_at)
        age_s = (now - started_s) if started_s else None

        claim = claim_map.get(session_id) or {}
        heartbeat_at = claim.get("heartbeat_at")
        hb_s = _parse_heartbeat(heartbeat_at)
        heartbeat_age_s = (now - hb_s) if hb_s else None

        # PID probe (signal 0 = existence check)
        pid_alive = False
        if pid:
            try:
                os.kill(pid, 0)
                pid_alive = True
            except (OSError, ProcessLookupError):
                pass

        # Freshness gate: either recent heartbeat or young session file
        has_fresh_heartbeat = heartbeat_age_s is not None and heartbeat_age_s <= SESSION_HEARTBEAT_FRESH_S
        is_fresh_file = age_s is not None and age_s <= SESSION_FRESH_S

        if not pid_alive:
            alive, liveness_reason = False, "dead_pid"
        elif has_fresh_heartbeat:
            alive, liveness_reason = True, "pid_and_heartbeat"
        elif is_fresh_file:
            alive, liveness_reason = True, "pid_and_fresh_file"
        else:
            alive, liveness_reason = False, "stale_pid_reuse"

        sessions.append({
            "file": f.name,
            "sessionId": session_id,
            "cwd": data.get("cwd", ""),
            "pid": pid,
            "alive": alive,
            "startedAt": started_at,
            "age_hours": round(age_s / 3600, 2) if age_s is not None else None,
            "liveness_reason": liveness_reason,
            "name": data.get("name"),
            "task_id": claim.get("task_id"),
            "heartbeat_at": heartbeat_at,
        })

    # Sort: alive first, then by startedAt desc
    sessions.sort(key=lambda s: (not s["alive"], -(_parse_started_at(s["startedAt"]) or 0)))
    return sessions


@router.get("/api/sessions", response_class=JSONResponse)
async def api_sessions():
    # Load claims once; _list_sessions uses them for heartbeat freshness check.
    try:
        conn = sqlite3.connect(str(TKT_DB_PATH))
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT task_id, session_id, heartbeat_at FROM claims").fetchall()
        conn.close()
        claim_map = {r["session_id"]: dict(r) for r in rows}
    except Exception:
        claim_map = {}

    return JSONResponse(_list_sessions(claim_map))


@router.get("/api/pipeline-state", response_class=JSONResponse)
async def api_pipeline_state():
    """Read active dev-flow pipeline states from /tmp session files."""
    state_files = globmod.glob("/tmp/claude-workflow-*.json")
    pipelines = []

    # Get claims for heartbeat data
    claims = {}
    try:
        conn = sqlite3.connect(str(TKT_DB_PATH))
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT task_id, session_id, heartbeat_at FROM claims").fetchall()
        conn.close()
        claims = {r["session_id"]: dict(r) for r in rows}
    except Exception:
        pass

    for path in state_files:
        try:
            with open(path) as f:
                state = jsonlib.load(f)
        except (jsonlib.JSONDecodeError, IOError):
            continue

        session_id = state.get("session_id", "")
        task_id = state.get("claimed_tkt")
        if not task_id:
            continue

        # Get heartbeat from claims
        claim = claims.get(session_id, {})
        heartbeat_at = claim.get("heartbeat_at")
        stale = False
        if heartbeat_at:
            try:
                hb_time = datetime.fromisoformat(heartbeat_at.replace("Z", "+00:00"))
                stale = (datetime.now(hb_time.tzinfo) - hb_time).total_seconds() > 300
            except Exception:
                pass
        else:
            mtime = os.path.getmtime(path)
            stale = (datetime.utcnow().timestamp() - mtime) > 300

        pipelines.append({
            "task_id": task_id,
            "title": state.get("ticket_title", ""),
            "type": state.get("ticket_type", ""),
            "domain": state.get("ticket_domain"),
            "session_id": session_id,
            "pipeline": state.get("pipeline", "code"),
            "size": state.get("size", "medium"),
            "started_at": state.get("started_at", ""),
            "heartbeat_at": heartbeat_at,
            "stale": stale,
            "steps": state.get("steps", {}),
        })

    return JSONResponse({"pipelines": pipelines})


@router.delete("/api/pipeline-state/{session_id}", response_class=JSONResponse)
async def delete_pipeline_state(session_id: str):
    """Clean up a stale pipeline state file and release the claim."""
    state_path = f"/tmp/claude-workflow-{session_id}.json"

    if os.path.exists(state_path):
        os.remove(state_path)

    try:
        conn = sqlite3.connect(str(TKT_DB_PATH))
        conn.execute("DELETE FROM claims WHERE session_id = ?", (session_id,))
        conn.commit()
        conn.close()
    except Exception:
        pass

    return JSONResponse({"ok": True})


@router.post("/api/launch-session", response_class=JSONResponse)
async def launch_session(request: Request):
    """Launch a new Claude Code session for a task, or resume an existing one."""
    body = await request.json()
    task_id = body.get("taskId")
    session_id = body.get("sessionId")  # If resuming
    project_dir = body.get("projectDir", "")

    if session_id:
        # Resume existing session — open new Ghostty tab with resume command
        cmd = f'claude -r {session_id}'
        _open_terminal(cmd, cwd=project_dir or None)
        return JSONResponse({"status": "resumed", "sessionId": session_id})

    if not task_id:
        return JSONResponse({"error": "taskId or sessionId required"}, status_code=400)

    # Fetch task details from tkt DB
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "backlog.db not found"}, status_code=500)

    task = conn.execute("""
        SELECT t.id, t.title, t.description, t.priority, t.project_id,
               p.name as project_name, p.repo_path
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        WHERE t.id = ?
    """, [task_id]).fetchone()
    conn.close()

    if not task:
        return JSONResponse({"error": f"Task {task_id} not found"}, status_code=404)

    task = dict(task)
    cwd = project_dir or task.get("repo_path") or str(Path.home())

    # Build the initial prompt for Claude (interactive mode, not -p)
    prompt = (
        f"Process backlog task #{task['id']}: {task['title']}. "
        f"Project: {task['project_name']}. Priority: {task['priority']}. "
        f"Use /backlog-workflow skill to claim and implement this task."
    )

    session_name = f"Task #{task['id']}: {task['title'][:40]}"
    cmd = f'claude -n {_shell_quote(session_name)} {_shell_quote(prompt)}'
    _open_terminal(cmd, cwd=cwd)

    return JSONResponse({"status": "launched", "taskId": task_id, "cwd": cwd})


@router.get("/api/tasks/{task_id}/detail", response_class=JSONResponse)
async def api_task_detail(task_id: int):
    """Get full task detail including history, notes, and related docs."""
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "backlog.db not found"}, status_code=500)

    task = conn.execute("""
        SELECT t.*, p.name as project_name, p.repo_path
        FROM tasks t JOIN projects p ON t.project_id = p.id
        WHERE t.id = ?
    """, [task_id]).fetchone()
    if not task:
        conn.close()
        return JSONResponse({"error": "not found"}, status_code=404)

    history = conn.execute("""
        SELECT field, old_value, new_value, changed_by, changed_at
        FROM task_history WHERE task_id = ? ORDER BY changed_at
    """, [task_id]).fetchall()

    notes = conn.execute("""
        SELECT content, added_by, created_at
        FROM task_notes WHERE task_id = ? ORDER BY created_at DESC
    """, [task_id]).fetchall()

    # Derive progress steps from history
    steps = []
    for h in history:
        h = dict(h)
        if h["field"] == "status":
            label = f'{h["old_value"] or "new"} → {h["new_value"]}'
        elif h["field"] == "imported":
            label = f'Imported {h["new_value"] or ""}'
        else:
            label = f'{h["field"]} updated'
        steps.append({"label": label, "timestamp": h["changed_at"], "field": h["field"]})

    # Collect related doc paths
    docs = []
    t = dict(task)
    if t.get("spec_path"):
        docs.append({"type": "spec", "path": t["spec_path"]})
    if t.get("description"):
        # Extract file paths from description
        import re
        paths = re.findall(r'`([/~][^`]+\.(md|txt|yml))`', t["description"])
        for path_match, _ in paths:
            docs.append({"type": "reference", "path": path_match})

    # Hierarchy context
    ancestors = list_ancestors(conn, task_id)
    parent = ancestors[0] if ancestors else None

    children_rows: list[dict] = []
    siblings_rows: list[dict] = []
    progress = None

    if t["type"] in PARENT_TYPES:
        rows = conn.execute(
            """
            SELECT id, title, type, status, priority, parent_id, slug
            FROM tasks WHERE parent_id = ? ORDER BY created_at ASC
            """,
            [task_id],
        ).fetchall()
        children_rows = [dict(r) for r in rows]
        for c in children_rows:
            if c["type"] in PARENT_TYPES:
                c["progress"] = compute_progress(conn, c["id"])
                c["children_count"] = count_children(conn, c["id"])
        progress = compute_progress(conn, task_id)

    if t["parent_id"] is not None:
        rows = conn.execute(
            """
            SELECT id, title, type, status, priority, parent_id, slug
            FROM tasks WHERE parent_id = ? AND id != ? ORDER BY created_at ASC
            """,
            [t["parent_id"], task_id],
        ).fetchall()
        siblings_rows = [dict(r) for r in rows]

    conn.close()

    return JSONResponse({
        "task": {
            "id": t["id"],
            "title": t["title"],
            "description": t["description"],
            "type": t["type"],
            "priority": t["priority"],
            "status": t["status"],
            "domain": t["domain"],
            "pr_number": t["pr_number"],
            "branch": t["branch"],
            "parent_id": t["parent_id"],
            "project_id": t["project_id"],
            "project_name": t["project_name"],
            "repo_path": t.get("repo_path"),
            "spec_path": t.get("spec_path"),
            "created_at": t["created_at"],
            "updated_at": t["updated_at"],
            "completed_at": t.get("completed_at"),
            "due_date": t.get("due_date"),
            "slug": t.get("slug"),
            "context": t.get("context"),
        },
        "parent": parent,
        "ancestors": ancestors,
        "children": children_rows,
        "siblings": siblings_rows,
        "progress": progress,
        "steps": steps,
        "notes": [dict(n) for n in notes],
        "docs": docs,
    })


@router.get("/api/docs/read", response_class=JSONResponse)
async def api_read_doc(path: str = Query(...)):
    """Lazy-load a document by path. Returns first 200 lines."""
    resolved = Path(path).expanduser()
    if not resolved.exists():
        return JSONResponse({"error": "File not found", "path": str(resolved)}, status_code=404)
    try:
        lines = resolved.read_text().splitlines()[:200]
        return JSONResponse({"path": str(resolved), "content": "\n".join(lines), "truncated": len(lines) == 200})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/api/sessions/{session_id}/preview", response_class=JSONResponse)
async def session_preview(session_id: str):
    """Get a conversation preview for a Claude Code session."""
    # Find the JSONL file across all project dirs
    claude_projects = Path.home() / ".claude" / "projects"
    jsonl_path = None
    if claude_projects.exists():
        for proj_dir in claude_projects.iterdir():
            candidate = proj_dir / f"{session_id}.jsonl"
            if candidate.exists():
                jsonl_path = candidate
                break

    if not jsonl_path:
        return JSONResponse({"turns": [], "totalTurns": 0, "error": "Session log not found"})

    try:
        turns = []
        with open(jsonl_path) as f:
            for line in f:
                msg = jsonlib.loads(line)
                msg_type = msg.get("type")
                if msg_type not in ("user", "assistant"):
                    continue
                content = msg.get("message", {}).get("content", "")
                if isinstance(content, str):
                    text = content.strip()
                elif isinstance(content, list):
                    text = " ".join(
                        c.get("text", "") for c in content
                        if isinstance(c, dict) and c.get("type") == "text"
                    ).strip()
                else:
                    continue
                if text:
                    turns.append({"role": msg_type, "text": text[:300]})

        # Return last 20 turns for preview
        return JSONResponse({
            "turns": turns[-20:],
            "totalTurns": len(turns),
        })
    except Exception as e:
        return JSONResponse({"turns": [], "totalTurns": 0, "error": str(e)})


GHOSTTY_BIN = "/Applications/Ghostty.app/Contents/MacOS/ghostty"


def _open_terminal(command: str, cwd: str | None = None):
    """Open a new Ghostty window with the given command."""
    shell_cmd = f'cd {cwd} && {command}' if cwd else command
    # Wrap in bash -lc so the shell profile is loaded (PATH, aliases, etc.)
    wrapped = f'bash -lc {_shell_quote(shell_cmd)}'

    if os.path.exists(GHOSTTY_BIN):
        try:
            # Use bash -li (login + interactive) so the session stays open
            subprocess.Popen(
                [GHOSTTY_BIN, "-e", "bash", "-lic", shell_cmd],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except Exception as e:
            print(f"[WARN] Ghostty launch failed, falling back to Terminal.app: {e}")

    # Fallback: macOS Terminal.app via AppleScript
    safe_cmd = shell_cmd.replace("\\", "\\\\").replace('"', '\\"')
    script = f'tell application "Terminal" to do script "{safe_cmd}"'
    try:
        subprocess.Popen(
            ["osascript", "-e", script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        print(f"[WARN] Failed to open terminal: {e}")


def _shell_quote(s: str) -> str:
    """Quote a string for safe shell use."""
    return "'" + s.replace("'", "'\\''") + "'"


# ── Project Inference ───────────────────────────────────────────────────────

def infer_project_from_domain(conn: sqlite3.Connection, domain: str) -> Optional[str]:
    """Infer project ID from domain using domain_project_map."""
    if not domain or not domain.strip():
        return None
    row = conn.execute(
        "SELECT project_id FROM domain_project_map WHERE domain = ? LIMIT 1",
        [domain.strip()],
    ).fetchone()
    return row["project_id"] if row else None


def infer_project_from_path(conn: sqlite3.Connection, description: str) -> Optional[str]:
    """Infer project ID from file paths in description.

    Examples:
      - app/module-hybrid-working/ → service-insight
      - tools/insight-admin/ → web-insight
      - packages/service-lib/ → service-insight
    """
    if not description:
        return None

    import re

    # Look for common module paths
    # Match patterns like: app/module-*, tools/*, packages/*
    patterns = [
        (r"app/module-(\w+)", "service-insight"),
        (r"app/", "service-insight"),
        (r"tools/insight-admin", "web-insight"),
        (r"tools/", "personal-workflow-automate"),
        (r"packages/", "service-insight"),
    ]

    for pattern, project_id in patterns:
        if re.search(pattern, description):
            return project_id

    return None


@router.get("/api/infer-project", response_class=JSONResponse)
async def api_infer_project(
    domain: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
):
    """Infer the correct project for a task based on domain and/or description.

    Returns:
      {
        "inferred_project": "project-id" or null,
        "inferred_from": "domain" | "path" | null,
        "confidence": "high" | "medium" | "low",
        "suggestion": "human-readable suggestion text"
      }
    """
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    try:
        inferred = None
        source = None
        confidence = "low"

        # Try domain-based inference first (highest priority)
        if domain:
            inferred = infer_project_from_domain(conn, domain)
            if inferred:
                source = "domain"
                confidence = "high"

        # Fall back to path-based inference if domain didn't match
        if not inferred and description:
            inferred = infer_project_from_path(conn, description)
            if inferred:
                source = "path"
                confidence = "medium"

        # Build human-readable suggestion
        suggestion = ""
        if inferred:
            project = conn.execute(
                "SELECT name FROM projects WHERE id = ?", [inferred]
            ).fetchone()
            project_name = project["name"] if project else inferred

            if source == "domain":
                suggestion = f"Domain '{domain}' maps to {project_name}"
            elif source == "path":
                suggestion = f"File paths suggest {project_name}"

        conn.close()
        return JSONResponse({
            "inferred_project": inferred,
            "inferred_from": source,
            "confidence": confidence,
            "suggestion": suggestion,
        })
    except Exception as e:
        conn.close()
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Domain Mapping & Misplaced Tasks ─────────────────────────────────────────

@router.get("/api/domain-map", response_class=JSONResponse)
async def api_domain_map():
    conn = get_tkt_db()
    if not conn:
        return JSONResponse([])
    rows = conn.execute(
        "SELECT domain, project_id, pattern FROM domain_project_map ORDER BY domain"
    ).fetchall()
    conn.close()
    return JSONResponse([dict(r) for r in rows])


@router.post("/api/domain-map", response_class=JSONResponse)
async def api_add_domain_map(request: Request):
    body = await request.json()
    domain = body.get("domain", "").strip()
    project_id = body.get("project_id", "").strip()
    pattern = body.get("pattern", "").strip() or None
    if not domain or not project_id:
        return JSONResponse({"error": "domain and project_id required"}, status_code=400)
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)
    conn.execute(
        "INSERT OR REPLACE INTO domain_project_map (domain, project_id, pattern) VALUES (?, ?, ?)",
        [domain, project_id, pattern],
    )
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True})


@router.delete("/api/domain-map", response_class=JSONResponse)
async def api_delete_domain_map(request: Request):
    body = await request.json()
    domain = body.get("domain", "")
    project_id = body.get("project_id", "")
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)
    conn.execute(
        "DELETE FROM domain_project_map WHERE domain = ? AND project_id = ?",
        [domain, project_id],
    )
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True})


@router.get("/api/misplaced-tasks", response_class=JSONResponse)
async def api_misplaced_tasks(project: Optional[str] = Query(None)):
    conn = get_tkt_db()
    if not conn:
        return JSONResponse([])

    # Find open tasks whose domain maps to a different project
    sql = """
        SELECT t.id, t.title, t.domain, t.project_id as current_project,
               dm.project_id as suggested_project,
               p_cur.name as current_project_name,
               p_sug.name as suggested_project_name
        FROM tasks t
        JOIN domain_project_map dm ON t.domain = dm.domain AND t.project_id != dm.project_id
        JOIN projects p_cur ON t.project_id = p_cur.id
        JOIN projects p_sug ON dm.project_id = p_sug.id
        WHERE t.status IN ('open', 'in_progress')
    """
    params: list = []
    if project:
        sql += " AND t.project_id = ?"
        params.append(project)
    sql += " ORDER BY t.priority, t.created_at"

    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return JSONResponse([dict(r) for r in rows])


@router.post("/api/tasks/bulk-move", response_class=JSONResponse)
async def api_bulk_move_tasks(request: Request):
    body = await request.json()
    task_ids = body.get("task_ids", [])
    target_project = body.get("project_id", "").strip()
    if not task_ids or not target_project:
        return JSONResponse({"error": "task_ids and project_id required"}, status_code=400)

    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    # Verify target project exists
    target = conn.execute("SELECT id FROM projects WHERE id = ?", [target_project]).fetchone()
    if not target:
        conn.close()
        return JSONResponse({"error": f"project '{target_project}' not found"}, status_code=404)

    moved = 0
    for tid in task_ids:
        task = conn.execute("SELECT project_id FROM tasks WHERE id = ?", [tid]).fetchone()
        if not task or task["project_id"] == target_project:
            continue
        old_project = task["project_id"]
        conn.execute("UPDATE tasks SET project_id = ? WHERE id = ?", [target_project, tid])
        conn.execute(
            "INSERT INTO task_history (task_id, field, old_value, new_value, changed_by) VALUES (?, 'projectId', ?, ?, 'dashboard')",
            [tid, old_project, target_project],
        )
        moved += 1

    conn.commit()
    conn.close()
    return JSONResponse({"ok": True, "moved": moved})


VALID_STATUSES = {"open", "in_progress", "done", "backlog"}
VALID_PRIORITIES = {"critical", "high", "medium", "low"}


@router.post("/api/tasks/bulk-update", response_class=JSONResponse)
async def api_bulk_update_tasks(request: Request):
    body = await request.json()
    task_ids = body.get("task_ids", [])
    new_status = body.get("status", "").strip() or None
    new_priority = body.get("priority", "").strip() or None

    if not task_ids:
        return JSONResponse({"error": "task_ids required"}, status_code=400)
    if not new_status and not new_priority:
        return JSONResponse({"error": "status or priority required"}, status_code=400)
    if new_status and new_status not in VALID_STATUSES:
        return JSONResponse({"error": f"invalid status: {new_status}"}, status_code=400)
    if new_priority and new_priority not in VALID_PRIORITIES:
        return JSONResponse({"error": f"invalid priority: {new_priority}"}, status_code=400)

    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    updated = 0
    for tid in task_ids:
        task = conn.execute("SELECT status, priority FROM tasks WHERE id = ?", [tid]).fetchone()
        if not task:
            continue

        changes = []
        if new_status and task["status"] != new_status:
            changes.append(("status", task["status"], new_status))
        if new_priority and task["priority"] != new_priority:
            changes.append(("priority", task["priority"], new_priority))

        if not changes:
            continue

        sets = []
        params: list = []
        for field, _, val in changes:
            sets.append(f"{field} = ?")
            params.append(val)
        if new_status == "done":
            sets.append("completed_at = datetime('now')")

        params.append(tid)
        conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", params)

        for field, old_val, new_val in changes:
            conn.execute(
                "INSERT INTO task_history (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, 'dashboard')",
                [tid, field, old_val, new_val],
            )
        updated += 1

    conn.commit()
    conn.close()
    return JSONResponse({"ok": True, "updated": updated})


@router.post("/api/tasks/{task_id}/move", response_class=JSONResponse)
async def api_move_task(task_id: int, request: Request):
    body = await request.json()
    target_project = body.get("project_id", "").strip()
    if not target_project:
        return JSONResponse({"error": "project_id required"}, status_code=400)

    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    task = conn.execute("SELECT project_id FROM tasks WHERE id = ?", [task_id]).fetchone()
    if not task:
        conn.close()
        return JSONResponse({"error": "task not found"}, status_code=404)

    old_project = task["project_id"]
    if old_project == target_project:
        conn.close()
        return JSONResponse({"ok": True, "message": "already in target project"})

    # Verify target project exists
    target = conn.execute("SELECT id FROM projects WHERE id = ?", [target_project]).fetchone()
    if not target:
        conn.close()
        return JSONResponse({"error": f"project '{target_project}' not found"}, status_code=404)

    conn.execute("UPDATE tasks SET project_id = ? WHERE id = ?", [target_project, task_id])
    conn.execute(
        "INSERT INTO task_history (task_id, field, old_value, new_value, changed_by) VALUES (?, 'projectId', ?, ?, 'dashboard')",
        [task_id, old_project, target_project],
    )
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True, "moved": {"from": old_project, "to": target_project}})


def _slugify(title: str, max_len: int = 60) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:max_len] if s else "untitled"


@router.post("/api/epics", response_class=JSONResponse)
async def api_create_epic(request: Request):
    """Create an epic. Optional `assign_to_task_id` attaches an existing task as a child
    in the same transaction so the caller never ends up with an orphan on partial failure.
    """
    body = await request.json()
    project_id = (body.get("project_id") or "").strip()
    title = (body.get("title") or "").strip()
    priority = body.get("priority") or "medium"
    domain = body.get("domain") or None
    assign_to = body.get("assign_to_task_id")

    if not project_id:
        return JSONResponse({"error": "project_id required"}, status_code=400)
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    if priority not in VALID_PRIORITIES:
        return JSONResponse({"error": f"invalid priority, must be one of {sorted(VALID_PRIORITIES)}"}, status_code=400)

    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    target = conn.execute("SELECT id FROM projects WHERE id = ?", [project_id]).fetchone()
    if not target:
        conn.close()
        return JSONResponse({"error": f"project '{project_id}' not found"}, status_code=404)

    if assign_to is not None:
        child = conn.execute(
            "SELECT id, project_id, parent_id FROM tasks WHERE id = ?", [assign_to]
        ).fetchone()
        if not child:
            conn.close()
            return JSONResponse({"error": f"assign_to_task_id #{assign_to} not found"}, status_code=404)
        if child["project_id"] != project_id:
            conn.close()
            return JSONResponse(
                {"error": "assign_to_task_id must belong to the same project"},
                status_code=400,
            )

    try:
        cur = conn.execute(
            "INSERT INTO tasks (project_id, title, type, priority, status, domain, slug) "
            "VALUES (?, ?, 'epic', ?, 'open', ?, ?)",
            [project_id, title, priority, domain, _slugify(title)],
        )
        new_id = cur.lastrowid

        if assign_to is not None:
            old_parent = child["parent_id"]
            conn.execute("UPDATE tasks SET parent_id = ? WHERE id = ?", [new_id, assign_to])
            conn.execute(
                "INSERT INTO task_history (task_id, field, old_value, new_value, changed_by) "
                "VALUES (?, 'parent_id', ?, ?, 'dashboard')",
                [assign_to, str(old_parent) if old_parent is not None else None, str(new_id)],
            )
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise

    row = conn.execute(
        "SELECT id, project_id, title, type, priority, status, domain, parent_id, slug, created_at "
        "FROM tasks WHERE id = ?",
        [new_id],
    ).fetchone()
    conn.close()
    return JSONResponse(dict(row), status_code=201)


@router.post("/api/tasks/{task_id}/set-parent", response_class=JSONResponse)
async def api_set_parent(task_id: int, request: Request):
    """Assign or clear a task's parent (epic/initiative). Body: {parent_id: N|null}."""
    body = await request.json()
    parent_id = body.get("parent_id")

    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    task = conn.execute("SELECT id, project_id, parent_id FROM tasks WHERE id = ?", [task_id]).fetchone()
    if not task:
        conn.close()
        return JSONResponse({"error": "task not found"}, status_code=404)

    if parent_id is not None:
        parent = conn.execute(
            "SELECT id, project_id, type FROM tasks WHERE id = ?", [parent_id]
        ).fetchone()
        if not parent:
            conn.close()
            return JSONResponse({"error": f"parent task #{parent_id} not found"}, status_code=404)
        if parent["type"] not in PARENT_TYPES:
            conn.close()
            return JSONResponse(
                {"error": f"parent must be one of {list(PARENT_TYPES)}, got '{parent['type']}'"},
                status_code=400,
            )
        if parent["project_id"] != task["project_id"]:
            conn.close()
            return JSONResponse(
                {"error": "parent must belong to the same project as the task"},
                status_code=400,
            )
        if parent_id == task_id:
            conn.close()
            return JSONResponse({"error": "task cannot be its own parent"}, status_code=400)

    old_parent = task["parent_id"]
    conn.execute("UPDATE tasks SET parent_id = ? WHERE id = ?", [parent_id, task_id])
    conn.execute(
        "INSERT INTO task_history (task_id, field, old_value, new_value, changed_by) "
        "VALUES (?, 'parent_id', ?, ?, 'dashboard')",
        [task_id, str(old_parent) if old_parent is not None else None,
         str(parent_id) if parent_id is not None else None],
    )
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True, "task_id": task_id, "parent_id": parent_id})


# ── Helpers ──────────────────────────────────────────────────────────────────

def _detect_phase(task) -> str:
    status = task["status"]
    pr = task["pr_number"]
    if status == "done":
        return "close"
    if status == "backlog":
        return "backlog"
    if pr:
        return "pr_ci"
    if status == "in_progress":
        return "implement"
    return "backlog"


@router.get("/api/insights", response_class=JSONResponse)
async def api_insights(
    pipeline: Optional[str] = Query(None),
    size: Optional[str] = Query(None),
    period: Optional[str] = Query("30d"),
):
    from datetime import timedelta

    conn = get_tkt_db()
    if not conn:
        return JSONResponse(
            {
                "flow_efficiency": [],
                "steps": [],
                "alerts": [],
                "total_runs": 0,
                "period": period or "30d",
            }
        )

    # ── Period cutoff ──────────────────────────────────────────────────────────
    period = period or "30d"
    cutoff: Optional[str] = None
    if period != "all":
        days_map = {"7d": 7, "30d": 30, "90d": 90}
        days = days_map.get(period, 30)
        cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")

    # ── Build WHERE clause ─────────────────────────────────────────────────────
    conditions: list[str] = []
    params: list = []

    if cutoff:
        conditions.append("started_at >= ?")
        params.append(cutoff)
    if pipeline:
        conditions.append("pipeline = ?")
        params.append(pipeline)
    if size:
        conditions.append("size = ?")
        params.append(size)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    # ── flow_efficiency (GROUP BY size) ───────────────────────────────────────
    fe_rows = conn.execute(
        f"""
        SELECT
            size,
            CAST(AVG(duration_s) AS INTEGER) AS avg_duration_s,
            MIN(duration_s) AS min_duration_s,
            MAX(duration_s) AS max_duration_s,
            COUNT(*) AS count
        FROM pipeline_runs
        {where}
        GROUP BY size
        ORDER BY avg_duration_s
        """,
        params,
    ).fetchall()

    flow_efficiency = [
        {
            "size": r["size"],
            "avg_duration_s": r["avg_duration_s"],
            "min_duration_s": r["min_duration_s"],
            "max_duration_s": r["max_duration_s"],
            "count": r["count"],
        }
        for r in fe_rows
    ]

    # ── total_runs & avg pipeline duration ────────────────────────────────────
    summary = conn.execute(
        f"SELECT COUNT(*) AS cnt, AVG(duration_s) AS avg_dur FROM pipeline_runs {where}",
        params,
    ).fetchone()
    total_runs: int = summary["cnt"] if summary else 0
    avg_pipeline_duration: float = summary["avg_dur"] or 0.0

    # ── steps aggregation (parse JSON per row) ────────────────────────────────
    run_rows = conn.execute(
        f"SELECT steps FROM pipeline_runs {where}", params
    ).fetchall()

    # step_name -> {durations, done, failed, skipped, total}
    step_data: dict[str, dict] = {}

    for row in run_rows:
        try:
            steps_json: dict = jsonlib.loads(row["steps"] or "{}")
        except (ValueError, TypeError):
            continue

        for step_name, info in steps_json.items():
            if step_name not in step_data:
                step_data[step_name] = {
                    "durations": [],
                    "done": 0,
                    "failed": 0,
                    "skipped": 0,
                    "total": 0,
                }
            entry = step_data[step_name]
            entry["total"] += 1

            status = (info.get("status") or "").lower()
            if status == "done":
                entry["done"] += 1
            elif status in ("failed", "error"):
                entry["failed"] += 1
            elif status in ("skipped", "skip"):
                entry["skipped"] += 1

            # Duration: prefer explicit duration_s, fall back to timestamps
            dur = info.get("duration_s")
            if dur is None:
                started = info.get("started_at")
                completed = info.get("completed_at")
                if started and completed:
                    try:
                        fmt = "%Y-%m-%dT%H:%M:%S"
                        dur = int(
                            (
                                datetime.strptime(completed[:19], fmt)
                                - datetime.strptime(started[:19], fmt)
                            ).total_seconds()
                        )
                    except (ValueError, TypeError):
                        dur = None
            if dur is not None and isinstance(dur, (int, float)) and dur >= 0:
                entry["durations"].append(dur)

    steps_list = []
    for step_name, entry in sorted(step_data.items()):
        total = entry["total"]
        durations = entry["durations"]
        avg_dur = int(sum(durations) / len(durations)) if durations else 0
        steps_list.append(
            {
                "name": step_name,
                "avg_duration_s": avg_dur,
                "skip_rate": round(entry["skipped"] / total, 4) if total else 0.0,
                "fail_rate": round(entry["failed"] / total, 4) if total else 0.0,
                "count": total,
            }
        )

    # ── alerts ────────────────────────────────────────────────────────────────
    alerts = []

    # bottleneck: step whose avg_duration_s > 40% of avg total pipeline duration
    if avg_pipeline_duration > 0:
        for s in steps_list:
            if s["avg_duration_s"] > 0:
                pct = s["avg_duration_s"] / avg_pipeline_duration
                if pct > 0.40:
                    alerts.append(
                        {
                            "type": "bottleneck",
                            "step": s["name"],
                            "message": f"{round(pct * 100)}% of total pipeline time",
                        }
                    )

    # high_fail: fail_rate > 0.10
    for s in steps_list:
        if s["fail_rate"] > 0.10:
            alerts.append(
                {
                    "type": "high_fail",
                    "step": s["name"],
                    "value": s["fail_rate"],
                    "message": f"{round(s['fail_rate'] * 100)}% fail rate",
                }
            )

    # high_skip: skip_rate > 0.40
    for s in steps_list:
        if s["skip_rate"] > 0.40:
            alerts.append(
                {
                    "type": "high_skip",
                    "step": s["name"],
                    "value": s["skip_rate"],
                    "message": f"Skipped {round(s['skip_rate'] * 100)}% of runs",
                }
            )

    conn.close()

    return JSONResponse(
        {
            "flow_efficiency": flow_efficiency,
            "steps": steps_list,
            "alerts": alerts,
            "total_runs": total_runs,
            "period": period,
        }
    )


@router.delete("/api/tasks/{task_id}", response_class=JSONResponse)
async def api_delete_task(task_id: int):
    conn = get_tkt_db()
    if not conn:
        return JSONResponse({"error": "db not found"}, status_code=500)

    task = conn.execute("SELECT id FROM tasks WHERE id = ?", [task_id]).fetchone()
    if not task:
        conn.close()
        return JSONResponse({"error": "task not found"}, status_code=404)

    conn.execute("DELETE FROM task_notes WHERE task_id = ?", [task_id])
    conn.execute("DELETE FROM tasks WHERE id = ?", [task_id])
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True})


# ── SPA catch-all for non-API routes ─────────────────────────────────────────
# React Router handles /workflow, /workflow/pipelines, /workflow/sessions etc.

from starlette.responses import FileResponse as _FileResponse

_SPA_INDEX = Path(__file__).parent.parent.parent / "frontend" / "dist" / "index.html"


@router.get("/", include_in_schema=False)
@router.get("/{path:path}", include_in_schema=False)
async def workflow_spa_fallback(request: Request, path: str = ""):
    """Serve the React SPA for all non-API workflow routes."""
    if _SPA_INDEX.exists():
        return _FileResponse(str(_SPA_INDEX))
    return JSONResponse({"error": "SPA not built. Run: cd frontend && pnpm build"}, status_code=503)



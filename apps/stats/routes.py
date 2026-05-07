"""Stats API routes for KB and scheduler analytics."""
import sqlite3
import os
from pathlib import Path
from datetime import datetime, timedelta
from fastapi import APIRouter, Query
from typing import Optional

router = APIRouter()

LOCAL_KB_DB = "/Users/ducduong/workspace/tools/local-kb/kb.db"
DOMAIN_KB_DB = os.path.expanduser("~/.domain-kb/knowledge.db")
SCHEDULER_DB = Path(__file__).parent.parent.parent / "claude-scheduler" / "data" / "scheduler.db"


def get_db_connection(db_path: str | Path) -> Optional[sqlite3.Connection]:
    """Open a database connection, return None if DB doesn't exist."""
    try:
        db_path_str = str(db_path)
        if not os.path.exists(db_path_str):
            return None
        return sqlite3.connect(db_path_str)
    except Exception:
        return None


@router.get("/overview")
async def stats_overview():
    """Return overview stats across all systems."""
    local_kb_stats = _get_local_kb_stats()
    domain_kb_stats = _get_domain_kb_stats()
    scheduler_stats = _get_scheduler_stats()

    return {
        "local_kb": local_kb_stats,
        "domain_kb": domain_kb_stats,
        "scheduler": scheduler_stats,
    }


def _get_local_kb_stats() -> dict:
    """Query local KB database for stats."""
    conn = get_db_connection(LOCAL_KB_DB)
    if not conn:
        return {"total_entries": 0, "by_domain": {}, "ratings": {"good": 0, "bad": 0, "great": 0}}

    try:
        cursor = conn.cursor()

        # Total entries
        cursor.execute("SELECT COUNT(*) FROM entries")
        total_entries = cursor.fetchone()[0]

        # By domain
        cursor.execute("SELECT domain, COUNT(*) FROM entries GROUP BY domain")
        by_domain = {row[0]: row[1] for row in cursor.fetchall()}

        # Ratings
        cursor.execute("SELECT rating, COUNT(*) FROM ratings GROUP BY rating")
        ratings_data = cursor.fetchall()
        ratings = {"good": 0, "bad": 0, "great": 0}
        for rating, count in ratings_data:
            if rating in ratings:
                ratings[rating] = count

        return {
            "total_entries": total_entries,
            "by_domain": by_domain,
            "ratings": ratings,
        }
    except Exception:
        return {"total_entries": 0, "by_domain": {}, "ratings": {"good": 0, "bad": 0, "great": 0}}
    finally:
        conn.close()


def _get_domain_kb_stats() -> dict:
    """Query domain KB database for stats."""
    conn = get_db_connection(DOMAIN_KB_DB)
    if not conn:
        return {"total_nodes": 0, "active_nodes": 0, "total_domains": 0}

    try:
        cursor = conn.cursor()

        # Total nodes
        cursor.execute("SELECT COUNT(*) FROM nodes")
        total_nodes = cursor.fetchone()[0]

        # Active nodes
        cursor.execute("SELECT COUNT(*) FROM nodes WHERE status = 'active'")
        active_nodes = cursor.fetchone()[0]

        # Total domains
        cursor.execute("SELECT COUNT(*) FROM domains")
        total_domains = cursor.fetchone()[0]

        return {
            "total_nodes": total_nodes,
            "active_nodes": active_nodes,
            "total_domains": total_domains,
        }
    except Exception:
        return {"total_nodes": 0, "active_nodes": 0, "total_domains": 0}
    finally:
        conn.close()


def _get_scheduler_stats() -> dict:
    """Query scheduler database for stats."""
    conn = get_db_connection(SCHEDULER_DB)
    if not conn:
        return {
            "runs_today": 0,
            "runs_7d": 0,
            "success_rate_7d": 0.0,
            "active_tasks": 0,
        }

    try:
        cursor = conn.cursor()

        # Runs today
        cursor.execute("SELECT COUNT(*) FROM task_runs WHERE date(started_at) = date('now')")
        runs_today = cursor.fetchone()[0]

        # Runs 7d + success rate
        cursor.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as ok "
            "FROM task_runs WHERE started_at >= datetime('now', '-7 days')"
        )
        row = cursor.fetchone()
        runs_7d = row[0] if row[0] else 0
        success_count = row[1] if row[1] else 0
        success_rate = success_count / runs_7d if runs_7d > 0 else 0.0

        # Active tasks
        cursor.execute("SELECT COUNT(*) FROM task_runs WHERE status = 'running'")
        active_tasks = cursor.fetchone()[0]

        return {
            "runs_today": runs_today,
            "runs_7d": runs_7d,
            "success_rate_7d": success_rate,
            "active_tasks": active_tasks,
        }
    except Exception:
        return {
            "runs_today": 0,
            "runs_7d": 0,
            "success_rate_7d": 0.0,
            "active_tasks": 0,
        }
    finally:
        conn.close()


@router.get("/views")
async def stats_views(period: int = Query(7, ge=1, le=365)):
    """Return top 10 most-viewed entries in the past N days."""
    conn = get_db_connection(LOCAL_KB_DB)
    if not conn:
        return []

    try:
        cursor = conn.cursor()
        query = f"""
            SELECT e.id, e.title, e.domain, COUNT(v.id) as view_count
            FROM views v
            JOIN entries e ON v.entry_id = e.id
            WHERE v.timestamp >= datetime('now', '-{period} days')
            GROUP BY e.id
            ORDER BY view_count DESC
            LIMIT 10
        """
        cursor.execute(query)
        rows = cursor.fetchall()
        return [
            {
                "id": row[0],
                "title": row[1],
                "domain": row[2],
                "view_count": row[3],
            }
            for row in rows
        ]
    except Exception:
        return []
    finally:
        conn.close()


@router.get("/runs")
async def stats_runs(limit: int = Query(20, ge=1, le=100)):
    """Return recent task runs from scheduler."""
    conn = get_db_connection(SCHEDULER_DB)
    if not conn:
        return []

    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT task_name, started_at, completed_at, status, duration_seconds, cost_usd "
            "FROM task_runs ORDER BY started_at DESC LIMIT ?",
            (limit,),
        )
        rows = cursor.fetchall()
        return [
            {
                "task_name": row[0],
                "started_at": row[1],
                "completed_at": row[2],
                "status": row[3],
                "duration_seconds": row[4],
                "cost_usd": row[5],
            }
            for row in rows
        ]
    except Exception:
        return []
    finally:
        conn.close()

"""Local Knowledge Base API routes — stats, search, trending, recent, ingest."""

import subprocess
import sys
from pathlib import Path

import yaml
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from starlette.responses import FileResponse as _FileResponse

router = APIRouter()

KB_ROOT = Path.home() / "workspace" / "tools" / "local-kb"
SOURCES_PATH = KB_ROOT / "sources.yaml"
sys.path.insert(0, str(KB_ROOT / "src"))


def _get_db():
    from local_kb.db import get_connection, init_db
    conn = get_connection(KB_ROOT / "kb.db")
    init_db(conn)
    return conn


def _entry_dict(e) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "domain": e.domain.value,
        "summary": e.summary,
        "context": getattr(e, "context", None),
        "key_takeaways": getattr(e, "key_takeaways", []),
        "tags": e.tags,
        "confidence": e.confidence.value,
        "source_type": e.source_type.value if e.source_type else None,
        "source": e.source or None,
        "created": e.created.isoformat(),
        "expires": e.expires if isinstance(e.expires, str) else (e.expires.isoformat() if e.expires else None),
    }


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/api/stats")
async def api_stats():
    from local_kb.db import get_stats
    return get_stats(_get_db())


# ---------------------------------------------------------------------------
# Entry CRUD
# ---------------------------------------------------------------------------

@router.get("/api/entry/{entry_id}")
async def api_get_entry(entry_id: str):
    from local_kb.db import get_entry
    entry = get_entry(_get_db(), entry_id)
    if not entry:
        return JSONResponse({"error": "Entry not found"}, status_code=404)
    return _entry_dict(entry)


@router.delete("/api/entry/{entry_id}")
async def api_delete_entry(entry_id: str):
    conn = _get_db()
    conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    conn.commit()
    for domain_dir in (KB_ROOT / "knowledge").iterdir():
        md_file = domain_dir / f"{entry_id}.md"
        if md_file.exists():
            md_file.unlink()
            break
    return {"ok": True}


# ---------------------------------------------------------------------------
# Search / Browse / Trending / Recent
# ---------------------------------------------------------------------------

@router.get("/api/search")
async def api_search(q: str = Query(""), domain: str = Query("")):
    from local_kb.db import search_entries
    conn = _get_db()
    entries = search_entries(conn, q, domain=domain or None, limit=20)
    return [_entry_dict(e) for e in entries]


@router.get("/api/browse")
async def api_browse(
    domain: str = Query(...),
    sort_by: str = Query("recent"),
    limit: int = Query(20),
):
    # Browse-by-domain must not route through FTS5 — an empty or punctuation-only
    # query raises `fts5: syntax error`, which is why the dashboard's Browse tile
    # was silently empty. Use the dedicated browse_entries path instead.
    from local_kb.db import browse_entries
    conn = _get_db()
    entries = browse_entries(conn, domain=domain, sort_by=sort_by, limit=limit)
    return [_entry_dict(e) for e in entries]


@router.get("/api/trending")
async def api_trending(days: int = Query(default=7), limit: int = Query(default=5)):
    from local_kb.db import get_trending
    conn = _get_db()
    entries = get_trending(conn, days=days, limit=limit)
    return [_entry_dict(e) for e in entries]


@router.get("/api/recent")
async def api_recent(limit: int = Query(default=10)):
    from local_kb.db import _row_to_entry
    conn = _get_db()
    rows = conn.execute(
        "SELECT * FROM entries ORDER BY created DESC LIMIT ?", (limit,)
    ).fetchall()
    return [_entry_dict(_row_to_entry(r)) for r in rows]


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

@router.post("/api/ingest")
async def api_ingest(payload: dict):
    url = payload.get("url", "").strip()
    domain = payload.get("domain", "tech-trends")
    if not url:
        return JSONResponse({"ok": False, "message": "URL is required"}, status_code=400)

    from local_kb.db import insert_entry, source_exists
    from local_kb.ingest.distiller import distill_content
    from local_kb.ingest.fetcher import fetch_web_page

    conn = _get_db()
    if source_exists(conn, url):
        return {"ok": False, "message": "URL already indexed."}

    raw = fetch_web_page(url, domain)
    if not raw:
        return {"ok": False, "message": f"Failed to fetch: {url}"}

    entry = distill_content(raw.content, source_url=url, domain=domain)
    if not entry:
        return {"ok": False, "message": "Content too thin to distill."}

    insert_entry(conn, entry)
    knowledge_dir = KB_ROOT / "knowledge" / entry.domain.value
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    (knowledge_dir / f"{entry.id}.md").write_text(entry.to_markdown())

    return {"ok": True, "message": f"Ingested: {entry.title}", "entry_id": entry.id, "title": entry.title}


@router.post("/api/ingest-all")
async def api_ingest_all():
    try:
        result = subprocess.run(
            [sys.executable, "-m", "local_kb.cli", "ingest-all"],
            capture_output=True, text=True, timeout=300,
            cwd=str(KB_ROOT),
        )
        return {"ok": True, "output": result.stdout + result.stderr}
    except subprocess.TimeoutExpired:
        return JSONResponse({"ok": False, "output": "Ingestion timed out after 5 minutes."}, status_code=504)


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

@router.get("/api/sources")
async def api_sources():
    if not SOURCES_PATH.exists():
        return {}
    with open(SOURCES_PATH) as f:
        data = yaml.safe_load(f)
    return data.get("sources", {})


# ---------------------------------------------------------------------------
# SPA catch-all — must be last so API routes take priority
# ---------------------------------------------------------------------------

_SPA_INDEX = Path(__file__).parent.parent.parent / "frontend" / "dist" / "index.html"


@router.get("/", include_in_schema=False)
@router.get("/{path:path}", include_in_schema=False)
async def kb_spa_fallback(request: Request, path: str = ""):
    """Serve the React SPA for all non-API KB routes."""
    if _SPA_INDEX.exists():
        return _FileResponse(str(_SPA_INDEX))
    return JSONResponse({"error": "SPA not built. Run: cd frontend && pnpm build"}, status_code=503)


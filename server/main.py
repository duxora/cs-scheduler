"""Tools Hub — FastAPI application."""
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path
from starlette.responses import FileResponse

app = FastAPI(title="Tools Hub")

SERVER_DIR = Path(__file__).parent
REPO_ROOT = SERVER_DIR.parent
templates = Jinja2Templates(directory=str(SERVER_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(SERVER_DIR / "static")), name="static")

# Registry of installed apps
APPS = []

def register_app(name: str, description: str, prefix: str, icon: str = "🔧"):
    APPS.append({"name": name, "description": description, "prefix": prefix, "icon": icon})


# ── SPA asset serving (must be registered BEFORE app routers) ─────────────

_SPA_DIST = REPO_ROOT / "frontend" / "dist"

@app.get("/assets/{file_path:path}", include_in_schema=False)
async def serve_spa_asset(file_path: str):
    """Serve hashed JS/CSS assets from frontend/dist/assets/."""
    full_path = _SPA_DIST / "assets" / file_path
    if full_path.is_file():
        return FileResponse(str(full_path))
    return FileResponse(str(_SPA_DIST / "index.html"), status_code=404)


# ── Register app routers ─────────────────────────────────────────────────────

from apps.scheduler.routes import router as scheduler_router
register_app("Scheduler", "Claude task scheduler dashboard", "/scheduler", "📋")
app.include_router(scheduler_router, prefix="/scheduler")

from apps.local_kb.routes import router as kb_router
register_app("Knowledge Base", "Local knowledge base with curated insights", "/kb", "📚")
app.include_router(kb_router, prefix="/kb")

from apps.telegram_bridge.routes import router as tg_router
register_app("Telegram Bridge", "Two-way Telegram bot with plugin system", "/telegram-bridge", "🤖")
app.include_router(tg_router, prefix="/telegram-bridge")

try:
    from apps.dev_workflow.routes import router as workflow_router
    register_app("Dev Workflow", "Dev-to-deploy pipeline dashboard", "/workflow", "🔄")
    app.include_router(workflow_router, prefix="/workflow")
except Exception as e:
    import traceback
    print(f"[WARN] Failed to load dev_workflow app: {e}")
    traceback.print_exc()

from apps.stats.routes import router as stats_router
register_app("Stats", "KB and scheduler analytics", "/stats", "📊")
app.include_router(stats_router, prefix="/api/stats")

# Redirect /prefix → /prefix/ for all app router prefixes
for _prefix in ["/workflow", "/scheduler", "/kb", "/telegram-bridge"]:
    app.get(_prefix, include_in_schema=False)(
        lambda _p=_prefix: RedirectResponse(f"{_p}/", status_code=307)
    )


# ── SPA routes — serve index.html for React Router paths ────────────────────

_SPA_INDEX = _SPA_DIST / "index.html"

@app.get("/stats", include_in_schema=False)
@app.get("/stats/{path:path}", include_in_schema=False)
async def serve_stats_spa(path: str = ""):
    return FileResponse(str(_SPA_INDEX))


# ── SPA catch-all ────────────────────────────────────────────────────────────

if _SPA_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_SPA_DIST), html=True), name="spa")
else:
    @app.get("/", response_class=HTMLResponse)
    async def portal(request: Request):
        return templates.TemplateResponse("portal.html", {"request": request, "apps": APPS})

import subprocess, json
from pathlib import Path

TKT_BIN = Path.home() / "workspace" / "tools" / "backlog" / "bin" / "tkt"

def run_tkt(args: list[str]) -> dict:
    try:
        out = subprocess.run([str(TKT_BIN), *args], capture_output=True, text=True, timeout=10)
        return {"ok": out.returncode == 0, "stdout": out.stdout, "stderr": out.stderr}
    except Exception as e:
        return {"ok": False, "error": str(e)}

#!/usr/bin/env python3
"""Jarvis proactive nudges — reads `tkt nudges --json`, sends a digest card to Telegram.

Runs from the claude-scheduler (hourly). Skips sending when digest.any is false.
Idempotent per-run: scheduler dedupes identical payloads via run metadata.

Env:
  TKT_DB           optional override, defaults to ~/.backlog/backlog.db
  NUDGES_DRY_RUN   if set, prints to stdout instead of sending to Telegram
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def _load_nudges() -> dict:
    cmd = ["tkt", "nudges", "--json", "--skip-focus-day"] if "--no-focus-day" in sys.argv else ["tkt", "nudges", "--json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f"tkt nudges failed: {r.stderr.strip()}")
    return json.loads(r.stdout)


def _fmt(digest: dict) -> str:
    lines: list[str] = ["*⚡ Jarvis nudges*"]

    drift = digest.get("effort_drift") or []
    if drift:
        lines.append("")
        lines.append("*Effort drift:*")
        for b in drift[:5]:
            lines.append(f"• `{b.get('type')}/{b.get('domain') or '—'}`  {b.get('suggestion','')}")

    aging = digest.get("aging_tickets") or []
    if aging:
        lines.append("")
        lines.append(f"*Aging (>{aging[0].get('age_days','?')}d, top {min(5,len(aging))}):*")
        for t in aging[:5]:
            pri = t.get("priority", "?")
            lines.append(f"• #{t['id']} ({pri}) — {t['title'][:70]}")

    fd = digest.get("focus_day_no_ship")
    if fd:
        lines.append("")
        lines.append(f"*Zero ships on {fd['date']}* — claimed={fd['claimed_count']}.")

    stale = digest.get("stale_handoffs") or []
    if stale:
        lines.append("")
        lines.append("*Stale handoffs (≥24h):*")
        for h in stale[:5]:
            task = h.get("handoff_task") or h["handoff_slug"]
            lines.append(f"• `{h['handoff_slug']}`  {h['age_hours']}h — {task[:60]}")

    blockers = digest.get("repeated_blockers") or []
    if blockers:
        lines.append("")
        lines.append("*Repeated verify_fail (last 2h):*")
        for b in blockers[:5]:
            lines.append(f"• task #{b['task_id']}  ×{b['count']}")

    return "\n".join(lines)


def _send_telegram(text: str) -> bool:
    repo = Path.home() / "workspace" / "tools" / "telegram-bridge" / "src"
    sys.path.insert(0, str(repo))
    from telegram_bridge.notify import send_to_scheduler
    return send_to_scheduler(text)


def main() -> int:
    digest = _load_nudges()
    if not digest.get("any"):
        print("no nudges pending")
        return 0
    text = _fmt(digest)
    if os.environ.get("NUDGES_DRY_RUN"):
        print(text)
        return 0
    ok = _send_telegram(text)
    print(f"sent={ok}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

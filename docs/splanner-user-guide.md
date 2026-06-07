# SPlanner — User Guide

Executive planning tool for managing high-level plans across **work | family | personal**. You own the structure; the AI owns the bookkeeping (classifying check-ins, drafting digests, surfacing risks).

Open it at **http://127.0.0.1:7070/splanner** (runs under launchd, always on).

---

## The mental model

```
Context (work | family | personal)
└── Project        — a named initiative with a priority
    └── Objective  — a measurable outcome (metric, target, current, deadline) — links to a tkt epic
        └── Item   — an execution step — links to a tkt ticket
            └── Check-in — the event stream feeding everything
```

Two rules make the model work:

1. **Check-ins are the fuel.** Everything downstream — AI classification, link suggestions, health, the weekly digest — derives from the check-in stream. A project with no check-ins is invisible to the AI.
2. **AI proposes, you decide.** The AI never mutates your structure. It tags check-ins, suggests links, and drafts digests; you accept, change, or approve.

---

## Getting started (10 minutes)

1. **Create 3–7 projects** on the dashboard, one per real initiative, spread across contexts. Set priority honestly — the dashboard ranks by it (blocked projects auto-boost to the top).
2. **Give each project 1–3 objectives, and make them measurable.** The KPI delta strip in the weekly digest only shows objectives with a numeric `current` value. "Ship migration" gives the AI nothing; `metric: slices shipped, target: 9, current: 4` gives it a week-over-week arrow.
3. **Add items only for active objectives.** Items are execution altitude — what you'd actually do this week. Stale item lists rot; keep them short.
4. **For work projects, push the whole objective into dev-flow with one click** — **Create epic** on the objective header. It creates a tkt epic, child tickets for every unlinked item, and adopts any already-linked tickets into the epic. From then on, every item you add gets its ticket created *inside* the epic automatically, and completing a ticket flips the item to done and logs a `win` check-in — zero bookkeeping.
5. Prefer ticket-by-ticket instead? "Create tkt" on an item row still works standalone; tickets created before the epic exists get adopted when you create it.

---

## Daily flow (~1 minute)

**Type free-text check-ins as things happen.** `⌘K` focuses the composer from anywhere; `⌘↑` broadens the scope (item → objective → project → global); `Esc` closes.

- Leave the kind on **Auto (AI)** — the default. Your check-in posts instantly as a note; ~10s later the AI tags it (`win | risk | decision | blocked | note`) and, when confident, suggests which project/objective/item it belongs to.
- **Act on the suggestion chip**: Accept links the check-in; Change opens the picker. Corrections persist — and a linked check-in feeds that project's health and digest narrative.
- Override Auto only when the kind is the point ("this is a *decision*") — explicit kinds skip the AI entirely.

**What writes itself** (the daemon runs every morning at 08:00):

| Source | What arrives |
|---|---|
| `calendar` | Yesterday's-and-today's *past* meetings as classified check-ins |
| `tkt` | Status changes on linked tickets — item status syncs, `win` on done |
| `life-graph` | New decisions/goals/commitments/lessons/ideas (reference noise filtered out) |

Filter the stream by kind or source chips. If a source floods you with noise, that's a signal to tune what you put into it, not to stop checking in.

**Effective check-in habits:**
- Write the *consequence*, not the activity: "vendor API slipping past June — launch at risk" classifies as `risk` and reads well in the digest; "had a call with vendor" is a note.
- One check-in per signal. Three signals in one paragraph classify as one kind.
- Don't pre-link everything manually — let the AI suggest and correct it when wrong. Your corrections are the quality loop.

---

## Weekly flow (~10 minutes, Monday)

The daemon drafts the digest automatically **Monday 08:30** (skipped if you already approved one for the week). Or hit **Draft digest** on `/splanner/digest` any time — it takes up to ~2 minutes.

Work top to bottom:

1. **KPI strip** — week-over-week arrows per objective. Flat arrows for objectives you worked on mean you forgot to update `current` — fix the objective, re-draft if it matters.
2. **Narrative** — AI-drafted from the week's check-ins, grouped by context. Edit inline (this moves the digest to *needs review*). The narrative is only as good as the week's check-ins.
3. **Risks panel** — severity-ranked with evidence counts. Evidence count 1 = a single offhand check-in; 3+ = a pattern worth acting on.
4. **Nudges** — stale objectives, pace, missing wins. Click-through goes to the project. A "missing wins" nudge on a busy project usually means you logged activity but never logged outcomes.
5. **Focus list** — tick the proposed focus items you actually commit to, then **Approve & save**. Approved digests are immutable (re-drafting a new one for the same week requires conscious intent — it resets to drafted).

The loop is: **capture → digest → focus → capture.** The focus items you accepted are what next week's check-ins should be about.

---

## Connectors

`Sources` row on any project detail page shows each connector's status with a **Sync now** button (manual pull between daemon runs).

- **calendar** — credentials at `~/.config/claude-scheduler/data/splanner-google.json` (`{client_id, client_secret, refresh_token, calendar_id}`). Re-auth helper: `python3 scripts/splanner-google-auth.py --client-id … --client-secret …`. Only *past* events are captured — upcoming meetings are not check-ins.
- **tkt** — reads `~/.backlog/backlog.db` directly; nothing to configure. Work-context only for linking.
- **life-graph** — reads `~/.life-graph/life-graph.db`; only signal entity types (decision, goal, commitment, lesson, idea).

Dedup is by `(source, source_ref)` and each connector keeps a watermark, so syncing twice never double-ingests.

---

## Epics — the objective ↔ dev-flow bridge (work context)

**Create epic** on an objective header opens a small panel: the target tkt project is pre-resolved (from where the objective's existing tickets live, else by name match), and the button reads exactly what will happen — *"Create epic + N tickets"*. "Customize items" lets you cherry-pick, but the default is the right call: all unlinked items become child tickets, all linked ones are adopted.

What it buys you:

- **One container in the backlog.** The objective is an epic; its items are the epic's children. Dev-flow (claim → branch → PR → done) operates on the children; SPlanner watches.
- **Cascade on new items.** Once the epic exists, "Create tkt" on any new item lands inside the epic, in the epic's project — no picking, no orphans.
- **Honest status.** Items linked to tickets show a read-only status badge ("synced from tkt #N") — tkt is the source of truth, and the daemon/Sync-now keeps it current. Unlinked items stay hand-editable.
- **No magic on the objective itself.** The epic's progress never auto-flips objective health — that stays your call (*AI proposes, you decide*).

---

## How the pieces behave (so nothing surprises you)

- **Auto check-ins appear as `note` first**, then update in place when classification lands (~10s; the stream polls itself for 90s after you post). If classification fails, the check-in stays a plain note — it never blocks or disappears.
- **Suggestions only come from the live tree** — archived projects are invisible to the AI. Archive aggressively; it sharpens classification.
- **KPI deltas are computed, not AI-generated.** The baseline is the previous digest's snapshot, so the first digest shows "—" arrows; they start moving from week two.
- **Approved digests can't be edited** (PATCH returns 409). That's the point — it's the record.
- **Daemon state** lives at `~/.config/claude-scheduler/data/splanner-daemon-state.json` (last capture date, per-connector watermarks, last digest week).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Check-ins never classify | Check `/tmp/automation-hub-error.log` for `checkin classification failed` — usually the `claude` binary or a timeout. Restart: `kill $(lsof -ti :7070)` (launchd respawns). |
| Calendar shows "needs credentials" | Credentials file missing/invalid — re-run `scripts/splanner-google-auth.py`. |
| Digest draft returns an error | The `claude -p` call failed or timed out (120s cap). Re-draft; no partial digest is ever written. |
| A source re-ingests cleared check-ins | Watermark missing in `splanner-daemon-state.json` — set the connector's timestamp to now. |
| Daemon didn't run | It only fires once per local day after 08:00; check `last_capture_date` in the state file. `SPLANNER_DAEMON=0` disables it entirely. |

---

## The one habit that matters

SPlanner degrades gracefully but honestly: skip check-ins for a week and the digest will be thin, the health stale, the nudges loud. The whole system is designed so that **30 seconds of free-text capture at the moment something happens** is the only discipline required — every other piece of bookkeeping is automated or one click.

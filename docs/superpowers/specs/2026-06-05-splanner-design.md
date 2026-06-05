# SPlanner — Self-Management Executive Planning Tool

**Status:** Design locked · **Date:** 2026-06-05 · **App:** `automation-hub/apps/splanner`

## Purpose

A single executive view for managing high-level plans across every part of life.
The user authors the plan skeleton; AI keeps it current — auto-classifies signals,
surfaces risks, drafts a weekly digest, and nudges on staleness. SPlanner is an
**author + AI-assist** tool, not an autonomous planner: the human owns the structure,
the AI owns the bookkeeping and the early-warning.

## Core Model

A five-level hierarchy. Context is a fixed enum; everything below is user-created.

```
Context (enum: work | family | personal)
  └─ Project        — a scope of work the user creates ("each scope of work is a project")
       └─ Objective — measurable outcome: metric, target, deadline, status
            └─ Item — a unit of execution: status, ETA, blockers, optional tkt link
                 └─ Check-in — timestamped signal; AI-classified kind; sourced
```

- **Context** classifies; it does not partition into roles. "CTO / leader / family head"
  are framings, not first-class objects.
- **Project** is the primary unit of the UI. Priority-ranked; blocked projects auto-boost.
- **Objective** carries the metric line (current vs target + trend) that makes "at risk"
  a fact, not an opinion.
- **Item** is the execution altitude — the only level that links to a tkt ticket.
- **Check-in** is the event stream feeding everything; manual entry is first-class,
  connectors append automatically.

### Entities

| Entity | Fields |
|---|---|
| **Project** | `id, context (enum), name, priority (int), status, archived (bool), created_at` |
| **Objective** | `id, project_id, name, metric, target, current, unit, deadline, status (on_track\|at_risk\|blocked\|done)` |
| **Item** | `id, objective_id, name, status (todo\|doing\|blocked\|done), eta, blockers (text), tkt_ticket_id (nullable — work context only)` |
| **Check-in** | `id, project_id (nullable), objective_id (nullable), item_id (nullable), body, kind (win\|risk\|decision\|blocked\|note), source (manual\|calendar\|tkt\|life-graph), source_ref, created_at, ai_classified (bool)` |
| **Digest** | `id, week_start, state (drafted\|needs_review\|approved), narrative_md, kpi_deltas (json), risks (json), nudges (json), focus (json), created_at` |

Context is a fixed enum. tkt linking is **work-context only** and lives on Item
(`tkt_ticket_id` nullable); Objectives may optionally map to a tkt epic.

## Architecture

Follows the existing `automation-hub` router-per-app pattern.

- **Storage:** per-app SQLite — `DATA_DIR / "splanner.db"`, same `Database` helper as `scheduler`.
- **Mount:** `app.include_router(splanner_router, prefix="/splanner")`; API under `/splanner/api`.
- **Frontend:** shared React SPA, new route group; client-side routing as existing apps.
- **AI worker:** headless `claude -p` subprocess (the `dev_flow` pattern) for two jobs —
  (1) classify an inbound check-in's `kind` + link suggestion, (2) generate the weekly digest.
- **Connectors:** one `Connector` port; adapters are pluggable and added by phase.

### Connector port

```python
class Connector(Protocol):
    name: str                      # "manual" | "calendar" | "tkt" | "life-graph"
    def poll(self, since: datetime) -> list[RawSignal]: ...
```

`RawSignal` → AI classify → `Check-in`. Manual entry bypasses `poll` (direct insert,
still AI-classified). Daily capture daemon calls `poll` on each registered connector.

## API Surface (`/splanner/api`)

```
GET    /projects?context=&include_archived=     # priority-ranked, with rolled-up health
POST   /projects                                # {context, name, priority?}
PATCH  /projects/{id}                           # rename, re-rank, archive
GET    /projects/{id}                           # detail: objectives + items + check-in stream
POST   /objectives                              # {project_id, name, metric, target, unit, deadline}
PATCH  /objectives/{id}                         # update current/status/...
POST   /items                                   # {objective_id, name, eta?, tkt_ticket_id?}
PATCH  /items/{id}                              # status/eta/blockers/tkt link
POST   /checkins                                # {body, project_id?|objective_id?|item_id?} → AI classifies kind+link
GET    /checkins?project_id=&kind=&source=      # filterable stream
GET    /digest/latest                           # current week
POST   /digest/draft                            # trigger AI draft (on-demand or Monday cron)
PATCH  /digest/{id}                             # inline edits, accept focus items
POST   /digest/{id}/approve                     # state → approved, persist
```

tkt integration is **read + create** (bidirectional): SPlanner reads ticket status to
update linked Item state, and can create a tkt ticket from an Item.

## UI (locked)

Three views, all priority-ranked, project-as-primary-unit, visualization-forward.

### Dashboard (LOCKED)
Priority-ranked project cards; blocked projects auto-boost to top. Context filter tabs,
KPI strip, per-project health stripe + stacked health bar + objective dots, latest-signal
line, quick check-in composer.

### Project detail
Two-pane. Header: context dot, name, why-ranked badge, totals, stacked health bar,
actions (add objective/item, connect source, archive). Left pane: collapsible objective
cards, each with a metric line (current vs target + trend) and its items list. Right pane:
filterable check-in stream (kind + source chips), AI link suggestions (accept/change).
Project-scoped composer (⌘K; ⌘↑ to re-scope).

### Weekly digest
AI-drafted Monday + on-demand. Top bar: week period ◀▶, lifecycle
(AI-drafted → needs review → approved), Re-draft / Approve&save. KPI delta strip
(week-over-week arrows). Main column: narrative rollup grouped by context (inline-editable);
proposed-focus list with accept checkboxes. Side column: severity-ranked Risks panel
(with evidence count); interactive Nudges (one-click actions for stale objectives / pace /
missing wins). Closes the loop: **capture → digest → focus → capture.**

## AI Worker

Two `claude -p` jobs, both producing strict JSON:

1. **Classify** (`POST /checkins`): given check-in body + the project/objective/item tree,
   return `{kind, suggested_link: {level, id}, confidence}`. Low confidence → `note`,
   no link; user corrects in the stream.
2. **Digest** (`POST /digest/draft`): given the week's check-ins + objective metric deltas,
   return `{narrative_md, kpi_deltas, risks[], nudges[], focus[]}`. State starts `drafted`;
   human edits + approves.

No autonomous mutation: AI proposes (classification, links, focus, nudges); the user
accepts. Approval is always a human action.

## Build Plan (Strategy A — vertical slices, core-first)

| Phase | Delivers |
|---|---|
| **1** | Model + CRUD + manual check-ins + dashboard. Usable standalone, no AI. |
| **2** | AI classify on check-in + on-demand weekly digest (project detail + digest views). |
| **3** | Connector framework + Google Calendar adapter. |
| **4** | tkt adapter (read+create) + life-graph adapter + daily capture daemon. |

Each phase ships a working slice. Phase 1 is the spine; AI and connectors layer on without
reshaping the core.

## Testing

- Model + CRUD: unit tests on repos (in-memory SQLite), one happy + one constraint case each.
- AI jobs: test the JSON contract with a stubbed `claude -p` (fixture stdout); assert parse
  + fallback-on-malformed.
- Connector port: contract test per adapter against a recorded `poll` fixture.
- API: route-level tests for the classify-on-create and digest-approve flows.

## Out of Scope (YAGNI)

- Role-based access / multi-user — single-user tool.
- Real-time push; daily polling cadence is sufficient.
- Autonomous plan editing by AI.
- Non-work tkt linking.

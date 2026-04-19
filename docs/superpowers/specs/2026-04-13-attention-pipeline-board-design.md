# Attention-Priority Pipeline Board

**Ticket:** tkt #414 — Visualize dev-flow in dev-workflow dashboard
**Date:** 2026-04-13
**Status:** Approved

## Problem

A solo developer orchestrates multiple concurrent Claude Code agents, each running its own dev-flow pipeline on different projects/tickets. The current Pipelines page shows a flat list of all pipelines — it treats every pipeline equally and forces the user to scan each one to determine which needs human attention.

The core question the user needs answered at all times: **"Which of my N active pipelines needs me RIGHT NOW?"**

## Design: Three-Lane Attention Board

Replace the flat `PipelineList` component in the Pipelines page with a board grouped by attention state.

### Lane 1: "Needs You" (amber/red header)

Pipelines where an agent is **blocked waiting for human input**. Detection rules:

| Condition | Signal |
|---|---|
| Any step has `status === 'failed'` | CI failed, E2E failed, build failed — needs triage |
| Pipeline `stale === true` AND active step is `review` or `pr` | Agent may be waiting for human review/approval |
| Pipeline `stale === true` AND no step is `pending` or `done` recently | Agent died or is stuck |

Cards in this lane show an **action hint**: "CI failed — 2 checks failing", "Stale — no heartbeat for 15m".

### Lane 2: "Running" (green header, pulsing dot)

Pipelines actively progressing without human input. All steps are either `done`, `pending`, or `skipped` — no `failed` steps, pipeline not stale.

Cards are **compact**: task ID, title, project, current step name, progress bar (step N/M), elapsed time.

### Lane 3: "Done Today" (gray header, collapsed by default)

Pipelines where all steps are `done` or `skipped`. Shows a count badge; expandable to see the list.

### Pipeline Card Layout

```
┌──────────────────────────────────────────────────┐
│ #595 Focus mgmt UI              personal-workflow │
│ ████████░░ step 8/10 — CI polling     ⏱ 12m      │
│ ⟳ Running                                        │
└──────────────────────────────────────────────────┘
```

When blocked:
```
┌──────────────────────────────────────────────────┐
│ #412 Auth migration               service-insight │
│ ██████░░░░ step 6/10 — CI                         │
│ ⚠ CI FAILED — build step failing          ⏱ 8m   │
└──────────────────────────────────────────────────┘
```

### Sorting Within Lanes

- **Needs You**: failed pipelines first (red), then stale (amber). Within each group, oldest-blocked first.
- **Running**: by elapsed time descending (longest-running first — more likely to need attention soon).
- **Done Today**: by completion time descending (most recent first).

## Architecture

### Files Changed

| File | Change |
|---|---|
| `components/PipelineBoard.tsx` | **New** — the three-lane board component |
| `components/PipelineCard.tsx` | **New** — compact card with progress bar and attention state |
| `lib/pipeline.ts` | **Add** `classifyPipeline()` and `getAttentionReason()` functions |
| `pages/PipelinesPage.tsx` | **Edit** — replace `<PipelineList>` with `<PipelineBoard>` |

### No files deleted

`PipelineList.tsx` and `PipelineStrip.tsx` stay — they may still be useful for other views or as fallback. The Pipelines page simply stops importing `PipelineList`.

### Classification Logic (`lib/pipeline.ts`)

```ts
type AttentionLane = 'needs_you' | 'running' | 'done'

interface ClassifiedPipeline {
  pipeline: PipelineState
  lane: AttentionLane
  reason: string | null   // human-readable action hint for "needs_you"
  progress: { done: number; total: number }
  activeStep: string | null
}

function classifyPipeline(p: PipelineState): ClassifiedPipeline
```

Classification priority:
1. Any step `failed` → `needs_you` (reason: "{step} failed")
2. `stale && activeStep in ['review', 'pr']` → `needs_you` (reason: "Stale — may need review")
3. `stale && no recent progress` → `needs_you` (reason: "Stale — no heartbeat")
4. All steps `done`/`skipped` → `done`
5. Otherwise → `running`

### Data Source

Same as current: `usePipelineState()` hook → `GET /pipeline-state` → 3s SWR refresh. No backend changes needed.

### Interaction

- Click a card → opens the existing `DetailPanel` (same `onSelect` callback as current `PipelineStrip`)
- "Done Today" lane header is clickable to expand/collapse
- Lanes with 0 items show a subtle empty state ("Nothing needs your attention" for lane 1)

## Styling

- Follow existing automation-hub theme tokens (`var(--hub-*)`, gray-900/800/700 palette)
- Lane headers: small uppercase text with colored dot indicator
- Progress bar: reuse `getStepColor()` and `getLineColor()` from `lib/pipeline.ts`
- "Needs You" cards get a left border accent: `border-l-2 border-amber-500` (stale) or `border-l-2 border-red-500` (failed)

## Out of Scope

- Sound/desktop notifications for attention state changes (future enhancement)
- Drag-and-drop between lanes
- Historical timeline/Gantt view (covered by Insights page)
- Modifying the dev-workflow dashboard (port 3800) — this change targets automation-hub only

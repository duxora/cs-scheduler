# Attention-Priority Pipeline Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat pipeline list with a three-lane attention board (Needs You / Running / Done Today) so a solo executor instantly sees which concurrent pipelines need human intervention.

**Architecture:** Add classification logic to `lib/pipeline.ts`, create two new components (`PipelineCard`, `PipelineBoard`), and swap `PipelineList` for `PipelineBoard` in `PipelinesPage`. No backend changes — same `/pipeline-state` SWR data source.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing automation-hub theme tokens

---

### Task 1: Add classification logic to `lib/pipeline.ts`

**Files:**
- Modify: `src/apps/workflow/lib/pipeline.ts`

- [ ] **Step 1: Add types and `classifyPipeline` function**

Append to the end of `src/apps/workflow/lib/pipeline.ts`:

```ts
// ── Attention classification ─────────────────────────────────────────────────

export type AttentionLane = 'needs_you' | 'running' | 'done'

export interface ClassifiedPipeline {
  pipeline: PipelineState
  lane: AttentionLane
  reason: string | null
  progress: { done: number; total: number }
  activeStep: string | null
}

export function getAttentionReason(p: PipelineState): string | null {
  const order = getStepOrder(p.pipeline, p.size)
  for (const step of order) {
    const state = p.steps[step]
    if (state?.status === 'failed') {
      return `${getStepLabel(step)} failed`
    }
  }

  if (p.stale) {
    const active = getActiveStep(p)
    if (active && ['review', 'pr'].includes(active)) {
      return `Stale — may need review`
    }
    return 'Stale — no heartbeat'
  }

  return null
}

export function classifyPipeline(p: PipelineState): ClassifiedPipeline {
  const progress = getPipelineProgress(p)
  const activeStep = getActiveStep(p)
  const reason = getAttentionReason(p)

  let lane: AttentionLane
  if (reason) {
    lane = 'needs_you'
  } else if (progress.done >= progress.total) {
    lane = 'done'
  } else {
    lane = 'running'
  }

  return { pipeline: p, lane, reason, progress, activeStep }
}

export function classifyAndGroup(pipelines: PipelineState[]): Record<AttentionLane, ClassifiedPipeline[]> {
  const groups: Record<AttentionLane, ClassifiedPipeline[]> = {
    needs_you: [],
    running: [],
    done: [],
  }

  for (const p of pipelines) {
    const c = classifyPipeline(p)
    groups[c.lane].push(c)
  }

  // Sort: needs_you by failed-first then stale, running by elapsed desc, done by elapsed desc
  groups.needs_you.sort((a, b) => {
    const aFailed = a.reason?.includes('failed') ? 0 : 1
    const bFailed = b.reason?.includes('failed') ? 0 : 1
    return aFailed - bFailed
  })
  groups.running.sort((a, b) =>
    new Date(a.pipeline.started_at).getTime() - new Date(b.pipeline.started_at).getTime()
  )
  groups.done.sort((a, b) =>
    new Date(b.pipeline.started_at).getTime() - new Date(a.pipeline.started_at).getTime()
  )

  return groups
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/apps/workflow/lib/pipeline.ts
git commit -m "feat(workflow): add pipeline attention classification logic"
```

---

### Task 2: Create `PipelineCard.tsx`

**Files:**
- Create: `src/apps/workflow/components/PipelineCard.tsx`

- [ ] **Step 1: Create the compact card component**

Create `src/apps/workflow/components/PipelineCard.tsx`:

```tsx
import type { DetailTarget } from '../types'
import type { ClassifiedPipeline } from '../lib/pipeline'
import { getStepLabel, getStepOrder, getStepColor, getLineColor } from '../lib/pipeline'
import { formatElapsed } from '../lib/time'

interface PipelineCardProps {
  classified: ClassifiedPipeline
  onSelect: (target: DetailTarget) => void
}

export default function PipelineCard({ classified, onSelect }: PipelineCardProps) {
  const { pipeline, lane, reason, progress, activeStep } = classified
  const pipelineLabel = pipeline.pipeline === 'code'
    ? `code/${pipeline.size}`
    : pipeline.pipeline

  const borderClass = lane === 'needs_you'
    ? reason?.includes('failed')
      ? 'border-l-2 border-l-red-500'
      : 'border-l-2 border-l-amber-500'
    : ''

  const steps = getStepOrder(pipeline.pipeline, pipeline.size)

  return (
    <div
      className={`bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors cursor-pointer ${borderClass}`}
      onClick={() => onSelect({ kind: 'pipeline', pipeline })}
    >
      {/* Header: task ID, title, project */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-gray-400 shrink-0">
            #{pipeline.task_id}
          </span>
          <span className="text-sm text-gray-200 truncate">
            {pipeline.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">
            {pipelineLabel}
          </span>
          {pipeline.domain && (
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">
              {pipeline.domain}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar + step info */}
      <div className="flex items-center gap-2 mb-1">
        <div className="flex items-center gap-0.5 flex-1">
          {steps.map((step, i) => {
            const state = pipeline.steps[step]
            if (!state || state.status === 'skipped') return null
            const isActive = step === activeStep
            const color = isActive && pipeline.stale
              ? 'bg-amber-500'
              : isActive
                ? 'bg-blue-500 animate-pulse'
                : getStepColor(state.status)
            return (
              <div
                key={step}
                className={`h-1.5 flex-1 rounded-full ${color}`}
                title={`${getStepLabel(step)}: ${state.status}`}
              />
            )
          })}
        </div>
        <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
          {progress.done}/{progress.total}
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {formatElapsed(pipeline.started_at)}
        </span>
      </div>

      {/* Status line */}
      <div className="flex items-center gap-1.5">
        {lane === 'needs_you' && reason && (
          <>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              reason.includes('failed') ? 'bg-red-500' : 'bg-amber-500'
            }`} />
            <span className={`text-xs ${
              reason.includes('failed') ? 'text-red-400' : 'text-amber-400'
            }`}>
              {reason}
            </span>
          </>
        )}
        {lane === 'running' && activeStep && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <span className="text-xs text-gray-400">
              {getStepLabel(activeStep)}
            </span>
          </>
        )}
        {lane === 'done' && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs text-gray-500">Complete</span>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/apps/workflow/components/PipelineCard.tsx
git commit -m "feat(workflow): add PipelineCard component for attention board"
```

---

### Task 3: Create `PipelineBoard.tsx`

**Files:**
- Create: `src/apps/workflow/components/PipelineBoard.tsx`

- [ ] **Step 1: Create the three-lane board component**

Create `src/apps/workflow/components/PipelineBoard.tsx`:

```tsx
import { useMemo, useState } from 'react'
import type { PipelineState, DetailTarget } from '../types'
import { classifyAndGroup } from '../lib/pipeline'
import type { AttentionLane } from '../lib/pipeline'
import PipelineCard from './PipelineCard'

interface PipelineBoardProps {
  pipelines: PipelineState[]
  onSelect: (target: DetailTarget) => void
}

const LANE_CONFIG: Record<AttentionLane, { label: string; dotColor: string; emptyText: string }> = {
  needs_you: {
    label: 'Needs You',
    dotColor: 'bg-amber-500',
    emptyText: 'Nothing needs your attention',
  },
  running: {
    label: 'Running',
    dotColor: 'bg-blue-500 animate-pulse',
    emptyText: 'No active pipelines',
  },
  done: {
    label: 'Done Today',
    dotColor: 'bg-gray-500',
    emptyText: 'No completed pipelines',
  },
}

export default function PipelineBoard({ pipelines, onSelect }: PipelineBoardProps) {
  const groups = useMemo(() => classifyAndGroup(pipelines), [pipelines])
  const [doneExpanded, setDoneExpanded] = useState(false)

  if (pipelines.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 py-12">
        <p className="text-sm">No active pipelines</p>
        <p className="text-xs mt-1">
          Claim a task with <code className="bg-gray-800 px-1 rounded">tkt_next</code> or launch from backlog
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Lane: Needs You */}
      <Lane
        lane="needs_you"
        items={groups.needs_you}
        onSelect={onSelect}
      />

      {/* Lane: Running */}
      <Lane
        lane="running"
        items={groups.running}
        onSelect={onSelect}
      />

      {/* Lane: Done Today (collapsible) */}
      <section>
        <button
          onClick={() => setDoneExpanded(!doneExpanded)}
          className="flex items-center gap-2 mb-2 group"
        >
          <span className={`w-2 h-2 rounded-full ${LANE_CONFIG.done.dotColor}`} />
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            {LANE_CONFIG.done.label}
          </h3>
          <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-full tabular-nums">
            {groups.done.length}
          </span>
          <span className="text-[10px] text-gray-600 group-hover:text-gray-400 transition-colors">
            {doneExpanded ? '▾' : '▸'}
          </span>
        </button>
        {doneExpanded && (
          <div className="flex flex-col gap-2">
            {groups.done.length === 0 ? (
              <p className="text-xs text-gray-600 pl-4">{LANE_CONFIG.done.emptyText}</p>
            ) : (
              groups.done.map((c) => (
                <PipelineCard key={c.pipeline.session_id} classified={c} onSelect={onSelect} />
              ))
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Lane({
  lane,
  items,
  onSelect,
}: {
  lane: AttentionLane
  items: ReturnType<typeof classifyAndGroup>[AttentionLane]
  onSelect: (target: DetailTarget) => void
}) {
  const config = LANE_CONFIG[lane]

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
          {config.label}
        </h3>
        {items.length > 0 && (
          <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-full tabular-nums">
            {items.length}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-xs text-gray-600 pl-4">{config.emptyText}</p>
        ) : (
          items.map((c) => (
            <PipelineCard key={c.pipeline.session_id} classified={c} onSelect={onSelect} />
          ))
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/apps/workflow/components/PipelineBoard.tsx
git commit -m "feat(workflow): add PipelineBoard three-lane component"
```

---

### Task 4: Wire PipelineBoard into PipelinesPage

**Files:**
- Modify: `src/apps/workflow/pages/PipelinesPage.tsx`

- [ ] **Step 1: Replace PipelineList import with PipelineBoard**

In `src/apps/workflow/pages/PipelinesPage.tsx`:

Replace the import:
```ts
import PipelineList from '../components/PipelineList'
```
With:
```ts
import PipelineBoard from '../components/PipelineBoard'
```

- [ ] **Step 2: Replace the PipelineList usage in JSX**

Replace:
```tsx
          {!isLoading && (
            <PipelineList pipelines={filtered} onSelect={setSelected} />
          )}
```
With:
```tsx
          {!isLoading && (
            <PipelineBoard pipelines={filtered} onSelect={setSelected} />
          )}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify lint passes**

Run: `pnpm lint`
Expected: No errors or warnings

- [ ] **Step 5: Commit**

```bash
git add src/apps/workflow/pages/PipelinesPage.tsx
git commit -m "feat(workflow): wire attention pipeline board into Pipelines page"
```

# Epic Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Epic Detail page — a 3-column status board showing all child tasks of an epic — so work can be managed and driven to completion at the epic level rather than navigating task-by-task.

**Architecture:** `EpicsPage` already fetches epics via `/api/roadmap`. Clicking an epic card navigates to `/workflow/epics/:id` (new route). `EpicDetailPage` fetches all tasks for the epic's project via `/api/tasks?project=<project_id>`, filters client-side by `parent_id === epicId`, and partitions into three columns by status. A `[→ Start]` quick-action on Open tasks calls `POST /api/tasks/bulk-update` to transition status to `in_progress` without a full page reload (SWR mutate). Clicking any task opens the existing `TaskDetailDrawer`.

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS, SWR, React Router v6, existing `TaskDetailDrawer` / `ProgressBar` / `PriorityBadge` / `TypeBadge` components.

---

## File Map

| File | Change |
|---|---|
| `frontend/src/apps/workflow/lib/urls.ts` | Add `epicPath()` helper |
| `frontend/src/apps/workflow/pages/EpicsPage.tsx` | Change card `onClick` + footer link to use `epicPath()` |
| `frontend/src/apps/workflow/pages/EpicDetailPage.tsx` | **Create** — full status-board page |
| `frontend/src/apps/workflow/App.tsx` | Register `epics/:id` route |

---

## Task 1: Add `epicPath()` URL helper

**Files:**
- Modify: `frontend/src/apps/workflow/lib/urls.ts`

- [ ] **Step 1: Add the helper after `treePath`**

Open `frontend/src/apps/workflow/lib/urls.ts` and add after the `treePath` function (line 13):

```ts
/** Build a `/workflow/epics/...` path from id + optional slug. */
export function epicPath(id: number, slug?: string | null): string {
  if (slug) return `/workflow/epics/${id}-${slug}`
  return `/workflow/epics/${id}`
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/ducduong/workspace/tools/automation-hub/frontend
git add src/apps/workflow/lib/urls.ts
git commit -m "feat(workflow): add epicPath URL helper"
```

---

## Task 2: Update `EpicCard` to navigate to Epic Detail

**Files:**
- Modify: `frontend/src/apps/workflow/pages/EpicsPage.tsx:1-8` (imports), `EpicsPage.tsx:22` (import epicPath), `EpicsPage.tsx:82` (onClick), `EpicsPage.tsx:140-153` (footer links)

Currently `EpicCard` navigates to `treePath(item.id, item.slug)` on click and shows a "Tree" link in the footer. After this task:
- Card click → `epicPath(item.id, item.slug)` (new Epic Detail page)
- Footer keeps a "Tree" link → `treePath(item.id, item.slug)` (unchanged)
- Footer adds a "Board" link to make the epic detail accessible directly too (optional, skip if too noisy)

- [ ] **Step 1: Add `epicPath` import in EpicsPage.tsx**

Find line (currently ~22):
```ts
import { treePath } from '../lib/urls'
```
Replace with:
```ts
import { treePath, epicPath } from '../lib/urls'
```

- [ ] **Step 2: Change card onClick**

Find (line ~82):
```ts
      onClick={() => navigate(treePath(item.id, item.slug))}
```
Replace with:
```ts
      onClick={() => navigate(epicPath(item.id, item.slug))}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd /Users/ducduong/workspace/tools/automation-hub/frontend
npm run build 2>&1 | tail -20
```
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/apps/workflow/pages/EpicsPage.tsx
git commit -m "feat(workflow): epic cards navigate to epic detail page"
```

---

## Task 3: Create `EpicDetailPage`

**Files:**
- Create: `frontend/src/apps/workflow/pages/EpicDetailPage.tsx`

This page:
1. Reads the epic `id` from the URL param (`epics/:id` — the ref may include a slug suffix like `42-my-epic`)
2. Fetches `/api/roadmap` to get the epic's header info (title, progress, project)
3. Fetches `/api/tasks?project=<project_id>&status=all` and filters by `parent_id === epicId`
4. Partitions tasks into 3 columns: **Open** (`open` + `backlog`), **In Progress** (`in_progress`), **Done** (`done`)
5. Shows an "up next" highlight: the first Open task sorted by priority descending (critical > high > medium > low), then `created_at` ascending as tiebreak
6. `[→ Start]` button on each Open task calls `POST /api/tasks/bulk-update` (single id) to move it to `in_progress`
7. Clicking any task row opens `TaskDetailDrawer`
8. Back link → `getTabUrl('/workflow/epics')` to restore filter state

**Priority sort order** (descending): `critical=4`, `high=3`, `medium=2`, `low=1`.

**Status columns and valid transitions from `[→ Start]`**:
- Open column: tasks with `status === 'open' || status === 'backlog'` — shows `[→ Start]` button
- In Progress column: tasks with `status === 'in_progress'` — no quick action
- Done column: tasks with `status === 'done'` — no quick action

- [ ] **Step 1: Create the file**

Create `frontend/src/apps/workflow/pages/EpicDetailPage.tsx` with the full content below:

```tsx
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import type { Task, RoadmapItem } from '../types'
import { parseIdFromRef } from '../lib/urls'
import { ProgressBar } from '../components/ui/ProgressBar'
import { PriorityBadge, PriorityDot } from '../components/ui/Badge'
import { TypeBadge } from '../components/ui/TypeBadge'
import TaskDetailDrawer from '../components/TaskDetailDrawer'
import { formatAgeCoarse } from '../lib/time'

// getTabUrl is defined in App.tsx but not exported — replicate the read-only half
function getTabUrl(base: string): string {
  try { return sessionStorage.getItem(`wf.tab.${base}`) ?? base } catch { return base }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const PRIORITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

function rankPriority(p: string): number {
  return PRIORITY_RANK[p] ?? 0
}

// ── Column header ─────────────────────────────────────────────────────────────

interface ColumnHeaderProps {
  label: string
  count: number
  accent: string
}

function ColumnHeader({ label, count, accent }: ColumnHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-1 mb-3">
      <span className={`w-1.5 h-1.5 rounded-full ${accent}`} />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="ml-auto text-[10px] text-slate-500">{count}</span>
    </div>
  )
}

// ── Task row card ─────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task
  isUpNext: boolean
  onOpen: (id: number) => void
  onStart?: (id: number) => Promise<void>
}

function TaskCard({ task, isUpNext, onOpen, onStart }: TaskCardProps) {
  const [starting, setStarting] = useState(false)

  async function handleStart(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onStart) return
    setStarting(true)
    try { await onStart(task.id) } finally { setStarting(false) }
  }

  return (
    <div
      className={`group rounded-md border p-2.5 cursor-pointer transition-all hover:border-indigo-500/50 ${
        isUpNext ? 'border-indigo-500/40 ring-1 ring-indigo-500/20' : ''
      }`}
      style={{ background: 'var(--wf-bg-card)', borderColor: isUpNext ? undefined : 'var(--wf-border)' }}
      onClick={() => onOpen(task.id)}
    >
      {isUpNext && (
        <div className="text-[9px] font-semibold uppercase tracking-widest text-indigo-400 mb-1.5">
          up next
        </div>
      )}
      <div className="flex items-start gap-1.5 mb-1">
        <TypeBadge type={task.type} />
        <span className="text-[10px] font-mono text-slate-500 shrink-0">#{task.id}</span>
        <PriorityDot priority={task.priority} />
      </div>
      <p className="text-[12px] font-medium text-slate-100 leading-snug line-clamp-2 mb-2 group-hover:text-white">
        {task.title}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">{formatAgeCoarse(task.updated_at)}</span>
        {onStart && (
          <button
            className="text-[10px] px-1.5 py-px rounded bg-indigo-900/50 text-indigo-300 border border-indigo-700/50 hover:bg-indigo-800/60 disabled:opacity-40"
            disabled={starting}
            onClick={handleStart}
          >
            {starting ? '...' : '→ Start'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  label: string
  accent: string
  tasks: Task[]
  upNextId: number | null
  onOpen: (id: number) => void
  onStart?: (id: number) => Promise<void>
}

function Column({ label, accent, tasks, upNextId, onOpen, onStart }: ColumnProps) {
  return (
    <div className="flex flex-col min-w-0">
      <ColumnHeader label={label} count={tasks.length} accent={accent} />
      <div className="flex flex-col gap-2 overflow-y-auto">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            isUpNext={t.id === upNextId}
            onOpen={onOpen}
            onStart={onStart}
          />
        ))}
        {tasks.length === 0 && (
          <div className="text-[11px] text-slate-600 italic px-1 py-3">None</div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EpicDetailPage() {
  const { id: idRef } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const epicId = parseIdFromRef(idRef)

  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null)

  // fetch roadmap to get epic header
  const { data: roadmap } = useSWR<RoadmapItem[]>('/workflow/api/roadmap', fetcher)
  const epic = useMemo(
    () => roadmap?.find((r) => r.id === epicId) ?? null,
    [roadmap, epicId]
  )

  // fetch tasks for project (once epic is known)
  const tasksUrl = epic ? `/workflow/api/tasks?project=${encodeURIComponent(epic.project_id)}&status=all` : null
  const { data: allTasks, mutate: mutateTasks } = useSWR<Task[]>(tasksUrl, fetcher)

  // filter to direct children of this epic
  const epicTasks = useMemo(
    () => (allTasks ?? []).filter((t) => t.parent_id === epicId),
    [allTasks, epicId]
  )

  // partition by status
  const openTasks = useMemo(
    () => epicTasks.filter((t) => t.status === 'open' || t.status === 'backlog')
      .sort((a, b) => {
        const pd = rankPriority(b.priority) - rankPriority(a.priority)
        if (pd !== 0) return pd
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }),
    [epicTasks]
  )
  const inProgressTasks = useMemo(
    () => epicTasks.filter((t) => t.status === 'in_progress'),
    [epicTasks]
  )
  const doneTasks = useMemo(
    () => epicTasks.filter((t) => t.status === 'done'),
    [epicTasks]
  )

  const upNextId = openTasks[0]?.id ?? null

  async function handleStart(taskId: number) {
    await fetch('/workflow/api/tasks/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: [taskId], status: 'in_progress' }),
    })
    await mutateTasks()
  }

  const progress = epic?.progress ?? { total: 0, done: 0, in_progress: 0, open: 0, percent: 0 }

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--wf-bg)' }}>
      {/* Header */}
      <div
        className="shrink-0 border-b px-4 py-3"
        style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <button
            className="text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
            onClick={() => navigate(getTabUrl('/workflow/epics'))}
          >
            ← Epics
          </button>
          {epic && (
            <>
              <span className="text-slate-600 text-[10px]">/</span>
              <TypeBadge type={epic.type} />
              <span className="text-[10px] font-mono text-slate-500">#{epic.id}</span>
              <PriorityBadge priority={epic.priority} />
            </>
          )}
        </div>
        {epic ? (
          <>
            <h1 className="text-sm font-semibold text-slate-100 mb-2">{epic.title}</h1>
            <div className="flex items-center gap-3">
              <div className="flex-1 max-w-xs">
                <ProgressBar done={progress.done} total={progress.total} showCounts showPercent height={1.5} />
              </div>
              <span className="text-[10px] text-slate-500">{epic.project_name}</span>
            </div>
          </>
        ) : (
          <div className="h-5 w-48 rounded bg-slate-800/60 animate-pulse" />
        )}
      </div>

      {/* Board columns */}
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-3 p-4 overflow-hidden">
        <Column
          label="Open"
          accent="bg-slate-500"
          tasks={openTasks}
          upNextId={upNextId}
          onOpen={setDrawerTaskId}
          onStart={handleStart}
        />
        <Column
          label="In Progress"
          accent="bg-amber-400"
          tasks={inProgressTasks}
          upNextId={null}
          onOpen={setDrawerTaskId}
        />
        <Column
          label="Done"
          accent="bg-emerald-400"
          tasks={doneTasks}
          upNextId={null}
          onOpen={setDrawerTaskId}
        />
      </div>

      <TaskDetailDrawer
        taskId={drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onNavigate={setDrawerTaskId}
      />
    </div>
  )
}
```

- [ ] **Step 2: Build to check for TypeScript errors**

```bash
cd /Users/ducduong/workspace/tools/automation-hub/frontend
npm run build 2>&1 | tail -30
```
Expected: clean build, no TS errors.

If `getTabUrl` is missing — it's a sessionStorage read, so it degrades gracefully; the function is inlined in the file above and doesn't need an import.

If `ProgressBar` props don't match — check `frontend/src/apps/workflow/components/ui/ProgressBar.tsx` for the exact prop names. The props `done`, `total`, `showCounts`, `showPercent`, `height` match the usage on `EpicsPage.tsx:99`.

- [ ] **Step 3: Commit**

```bash
git add src/apps/workflow/pages/EpicDetailPage.tsx
git commit -m "feat(workflow): add EpicDetailPage status board"
```

---

## Task 4: Register route in App.tsx

**Files:**
- Modify: `frontend/src/apps/workflow/App.tsx:7` (import), `App.tsx:162` (route)

- [ ] **Step 1: Add import**

Find (line ~9):
```ts
import TaskTreePage from './pages/TaskTreePage'
```
Add after it:
```ts
import EpicDetailPage from './pages/EpicDetailPage'
```

- [ ] **Step 2: Add route**

Find (line ~162):
```tsx
          <Route path="tree/:id" element={<TaskTreePage />} />
```
Add after it:
```tsx
          <Route path="epics/:id" element={<EpicDetailPage />} />
```

- [ ] **Step 3: Full rebuild and smoke test**

```bash
cd /Users/ducduong/workspace/tools/automation-hub/frontend
rm -rf dist && npm run build 2>&1 | tail -10
```
Expected: build succeeds with no errors.

Then open the app and verify:
1. Navigate to `http://localhost:7070/workflow/epics`
2. Click any epic card — should navigate to `/workflow/epics/<id>-<slug>`
3. Verify 3 columns render (Open / In Progress / Done) with tasks
4. The top Open task should show "up next" ring and `→ Start` button
5. Click `→ Start` — task should move from Open to In Progress (optimistic via SWR revalidation)
6. Click any task row — `TaskDetailDrawer` should open
7. Click `← Epics` back button — should return to Epics page preserving sort/filter from sessionStorage

- [ ] **Step 4: Commit**

```bash
git add src/apps/workflow/App.tsx
git commit -m "feat(workflow): register epics/:id route for EpicDetailPage"
```

---

## Self-Review

**Spec coverage check:**
- [x] 3-column status board (Open/In Progress/Done) → `Column` component in Task 3
- [x] "Up next" highlight on first Open task (priority desc, created_at asc tiebreak) → `openTasks` sort + `upNextId` in Task 3
- [x] `→ Start` quick action moves to `in_progress` → `handleStart` calls `POST /api/tasks/bulk-update` in Task 3
- [x] Click task → `TaskDetailDrawer` → `setDrawerTaskId` in Task 3
- [x] Back link preserves filter state → `getTabUrl('/workflow/epics')` in Task 3
- [x] Epic card click → epic detail → Task 2 updates `EpicsPage`
- [x] Route registered → Task 4

**No placeholders:** all steps contain actual code, exact paths, and exact commands.

**Type consistency:**
- `Task` and `RoadmapItem` imported from `../types` — match the definitions in `types/index.ts`
- `epicPath` exported from `lib/urls.ts` (Task 1) and imported in `EpicsPage.tsx` (Task 2) — names match
- `parseIdFromRef` from `lib/urls.ts` — already exported there at line 17
- `handleStart(taskId: number)` matches `onStart?: (id: number) => Promise<void>` — consistent
- `TaskDetailDrawer` props `taskId`, `onClose`, `onNavigate` match usage in `TaskTreePage.tsx:215-218`

**One edge case to watch:** if `/api/tasks` returns `status=all` literally as a query param, verify the backend ignores unknown status values or passes all tasks. Looking at `routes.py:159-161`: if `status` param is set, it filters. `status=all` would look for `status IN ('all')` which returns nothing. Use `status=open,in_progress,done,backlog` instead:

Fix `tasksUrl` in EpicDetailPage to:
```ts
const tasksUrl = epic
  ? `/workflow/api/tasks?project=${encodeURIComponent(epic.project_id)}&status=open,in_progress,done,backlog`
  : null
```

This is already the correct form since the backend splits on comma (line 160: `status.split(",")`). Update the file accordingly before committing Task 3.

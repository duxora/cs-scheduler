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

// Read-only session-storage helper — mirrors getTabUrl in App.tsx (not exported there)
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

// ── Task card ─────────────────────────────────────────────────────────────────

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

  const { data: roadmap } = useSWR<RoadmapItem[]>('/workflow/api/roadmap', fetcher)
  const epic = useMemo(
    () => roadmap?.find((r) => r.id === epicId) ?? null,
    [roadmap, epicId]
  )

  // fetch all tasks for the project, filtered to all statuses
  const tasksUrl = epic
    ? `/workflow/api/tasks?project=${encodeURIComponent(epic.project_id)}&status=open,in_progress,done,backlog`
    : null
  const { data: allTasks, mutate: mutateTasks } = useSWR<Task[]>(tasksUrl, fetcher)

  // direct children of this epic only
  const epicTasks = useMemo(
    () => (allTasks ?? []).filter((t) => t.parent_id === epicId),
    [allTasks, epicId]
  )

  const openTasks = useMemo(
    () =>
      epicTasks
        .filter((t) => t.status === 'open' || t.status === 'backlog')
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

      {/* Board */}
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

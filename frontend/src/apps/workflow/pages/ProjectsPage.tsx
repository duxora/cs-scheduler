import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import type { ProjectInsights } from '../types'
import { ContextBadge, PriorityBadge, PriorityDot } from '../components/ui/Badge'
import { ContextToken, CONTEXT_KEYS, Priority, type ContextKey } from '../lib/tokens'
import { formatAgeCoarse } from '../lib/time'
import { useUrlParam } from '../hooks/useUrlParam'
import { SegmentedControl } from '../components/ui/SegmentedControl'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface HealthSignal {
  tone: 'good' | 'warn' | 'bad' | 'muted'
  label: string
}

function deriveHealth(p: ProjectInsights): HealthSignal {
  if (p.overdue_count > 0) return { tone: 'bad', label: `${p.overdue_count} overdue` }
  if (p.stale_count >= 5) return { tone: 'warn', label: `${p.stale_count} stale` }
  if (p.in_progress_count > 3) return { tone: 'warn', label: 'WIP heavy' }
  if (p.active_epic_count > 0 && p.in_progress_count === 0 && p.open_count > 0) {
    return { tone: 'warn', label: 'No work started' }
  }
  if (p.done_14d >= 5) return { tone: 'good', label: 'Shipping' }
  if (p.open_count + p.in_progress_count === 0) return { tone: 'muted', label: 'Idle' }
  return { tone: 'good', label: 'Healthy' }
}

const HEALTH_CLS: Record<HealthSignal['tone'], string> = {
  good: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50',
  warn: 'bg-amber-900/50 text-amber-300 border border-amber-700/50',
  bad: 'bg-red-900/50 text-red-300 border border-red-700/50',
  muted: 'bg-slate-800/60 text-slate-400 border border-slate-700/50',
}

const CONTEXT_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'work', label: ContextToken.display.work },
  { value: 'family', label: ContextToken.display.family },
  { value: 'personal', label: ContextToken.display.personal },
  { value: '__unclassified', label: 'Unclassified' },
]

const VIEW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
]

function ProjectInsightCard({ p }: { p: ProjectInsights }) {
  const health = deriveHealth(p)
  const totalActive = p.open_count + p.in_progress_count + p.backlog_count
  const total = totalActive + p.done_count
  const donePct = total === 0 ? 0 : Math.round((p.done_count / total) * 100)

  return (
    <Link
      to={`/workflow?project=${encodeURIComponent(p.project_id)}`}
      className="group block rounded-xl border p-3.5 transition-all hover:border-indigo-500/60 hover:shadow-lg hover:shadow-indigo-900/10"
      style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-100 truncate group-hover:text-white">
            {p.project_name}
          </h3>
          <p className="text-[10px] font-mono text-slate-500 truncate">{p.project_id}</p>
        </div>
        <ContextBadge context={p.context} />
      </div>

      {/* Health pill */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className={`text-[10px] px-1.5 py-px rounded ${HEALTH_CLS[health.tone]}`}>
          {health.label}
        </span>
        {p.top_priority && (
          <span className="flex items-center gap-1">
            <PriorityDot priority={p.top_priority} />
            <span className={`text-[10px] ${Priority.label[p.top_priority as keyof typeof Priority.label] ?? Priority.fallback.label}`}>
              {Priority.display[p.top_priority as keyof typeof Priority.display] ?? p.top_priority}
            </span>
          </span>
        )}
        <span className="text-[10px] text-slate-500">
          Active {formatAgeCoarse(p.last_activity)}
        </span>
      </div>

      {/* Metric row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <Metric label="WIP" value={p.in_progress_count} tone={p.in_progress_count > 3 ? 'warn' : 'amber'} />
        <Metric label="Open" value={p.open_count} tone="blue" />
        <Metric label="Epics" value={p.active_epic_count} tone="indigo" />
        <Metric label="14d ✓" value={p.done_14d} tone="emerald" />
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-1 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${donePct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0">
          {donePct}%
        </span>
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-1">
        {p.stale_count > 0 && (
          <span className="text-[10px] px-1.5 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
            {p.stale_count} stale&nbsp;(&gt;14d)
          </span>
        )}
        {p.overdue_count > 0 && (
          <span className="text-[10px] px-1.5 py-px rounded bg-red-900/40 text-red-300 border border-red-700/40">
            {p.overdue_count} overdue
          </span>
        )}
        {p.backlog_count > 0 && (
          <span className="text-[10px] px-1.5 py-px rounded bg-indigo-900/40 text-indigo-300 border border-indigo-700/40">
            {p.backlog_count} backlog
          </span>
        )}
      </div>
    </Link>
  )
}

const METRIC_TONE = {
  amber: 'text-amber-300',
  blue: 'text-blue-300',
  emerald: 'text-emerald-300',
  indigo: 'text-indigo-300',
  slate: 'text-slate-300',
  warn: 'text-orange-300',
} as const

function Metric({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number
  tone?: keyof typeof METRIC_TONE
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md bg-slate-900/50 border border-slate-800 py-1">
      <span className={`text-sm font-semibold tabular-nums ${METRIC_TONE[tone]}`}>{value}</span>
      <span className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</span>
    </div>
  )
}

function Num({ value, tone = 'slate' }: { value: number; tone?: keyof typeof METRIC_TONE }) {
  const cls = value === 0 ? 'text-slate-600' : METRIC_TONE[tone]
  return <span className={`tabular-nums font-medium ${cls}`}>{value}</span>
}

function ProjectListRow({ p }: { p: ProjectInsights }) {
  const health = deriveHealth(p)
  const total = p.open_count + p.in_progress_count + p.backlog_count + p.done_count
  const donePct = total === 0 ? 0 : Math.round((p.done_count / total) * 100)

  return (
    <tr
      className="border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors"
    >
      {/* Name + id */}
      <td className="px-3 py-2">
        <Link
          to={`/workflow?project=${encodeURIComponent(p.project_id)}`}
          className="group block"
        >
          <div className="text-sm font-medium text-slate-100 group-hover:text-white truncate max-w-[240px]">
            {p.project_name}
          </div>
          <div className="text-[10px] font-mono text-slate-500 truncate max-w-[240px]">
            {p.project_id}
          </div>
        </Link>
      </td>

      {/* Context */}
      <td className="px-3 py-2">
        <ContextBadge context={p.context} />
      </td>

      {/* Status (health) */}
      <td className="px-3 py-2">
        <span className={`text-[10px] px-1.5 py-px rounded ${HEALTH_CLS[health.tone]}`}>
          {health.label}
        </span>
      </td>

      {/* Top priority */}
      <td className="px-3 py-2">
        {p.top_priority ? (
          <PriorityBadge priority={p.top_priority} />
        ) : (
          <span className="text-[10px] text-slate-600">—</span>
        )}
      </td>

      {/* WIP / Open / Backlog */}
      <td className="px-3 py-2 text-center text-xs"><Num value={p.in_progress_count} tone={p.in_progress_count > 3 ? 'warn' : 'amber'} /></td>
      <td className="px-3 py-2 text-center text-xs"><Num value={p.open_count} tone="blue" /></td>
      <td className="px-3 py-2 text-center text-xs"><Num value={p.backlog_count} tone="indigo" /></td>

      {/* Epics */}
      <td className="px-3 py-2 text-center text-xs"><Num value={p.active_epic_count} tone="indigo" /></td>

      {/* Critical / High priority counts */}
      <td className="px-3 py-2 text-center text-xs">
        <Num value={p.critical_count} tone={p.critical_count > 0 ? 'warn' : 'slate'} />
      </td>
      <td className="px-3 py-2 text-center text-xs">
        <Num value={p.high_count} tone="amber" />
      </td>

      {/* Flags */}
      <td className="px-3 py-2 text-center text-xs"><Num value={p.stale_count} tone={p.stale_count > 0 ? 'amber' : 'slate'} /></td>
      <td className="px-3 py-2 text-center text-xs"><Num value={p.overdue_count} tone={p.overdue_count > 0 ? 'warn' : 'slate'} /></td>
      <td className="px-3 py-2 text-center text-xs"><Num value={p.done_14d} tone="emerald" /></td>

      {/* Progress */}
      <td className="px-3 py-2 min-w-[120px]">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-1 rounded-full transition-all ${donePct === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500'}`}
              style={{ width: `${donePct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-400 tabular-nums w-8 text-right">{donePct}%</span>
        </div>
      </td>

      {/* Last activity */}
      <td className="px-3 py-2 text-[10px] text-slate-400 whitespace-nowrap">
        {formatAgeCoarse(p.last_activity)}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Link
            to={`/workflow?project=${encodeURIComponent(p.project_id)}`}
            className="text-[10px] px-1.5 py-px rounded bg-slate-800/80 text-slate-200 hover:bg-slate-700 border border-slate-700/60"
            title="Open task board for this project"
          >
            Tasks
          </Link>
          <Link
            to={`/workflow/epics?project=${encodeURIComponent(p.project_id)}`}
            className="text-[10px] px-1.5 py-px rounded bg-slate-800/80 text-slate-200 hover:bg-slate-700 border border-slate-700/60"
            title="Open epics for this project"
          >
            Epics
          </Link>
        </div>
      </td>
    </tr>
  )
}

function ProjectListTable({ items }: { items: ProjectInsights[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800" style={{ background: 'var(--wf-bg-card)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800 bg-slate-900/40">
            <th className="px-3 py-2 font-medium">Project</th>
            <th className="px-3 py-2 font-medium">Context</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium text-center" title="In progress">WIP</th>
            <th className="px-3 py-2 font-medium text-center">Open</th>
            <th className="px-3 py-2 font-medium text-center">Backlog</th>
            <th className="px-3 py-2 font-medium text-center" title="Active initiatives + epics">Epics</th>
            <th className="px-3 py-2 font-medium text-center" title="Critical-priority open tasks">Crit</th>
            <th className="px-3 py-2 font-medium text-center" title="High-priority open tasks">High</th>
            <th className="px-3 py-2 font-medium text-center" title="Open tasks older than 14 days">Stale</th>
            <th className="px-3 py-2 font-medium text-center" title="Past due date">Over</th>
            <th className="px-3 py-2 font-medium text-center" title="Done in last 14 days">14d ✓</th>
            <th className="px-3 py-2 font-medium">Progress</th>
            <th className="px-3 py-2 font-medium">Active</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => <ProjectListRow key={p.project_id} p={p} />)}
        </tbody>
      </table>
    </div>
  )
}

export default function ProjectsPage() {
  const { data, isLoading, error } = useSWR<ProjectInsights[]>(
    '/workflow/api/projects-insights',
    fetcher,
    { refreshInterval: 15000 },
  )
  const [contextFilter, setContextFilter] = useUrlParam('context')
  const [view, setView] = useUrlParam('view', 'grid')

  const filtered = useMemo(() => {
    if (!data) return []
    if (!contextFilter) return data
    if (contextFilter === '__unclassified') return data.filter((p) => !p.context)
    return data.filter((p) => p.context === contextFilter)
  }, [data, contextFilter])

  const grouped = useMemo(() => {
    const buckets: Record<string, ProjectInsights[]> = { unclassified: [] }
    for (const k of CONTEXT_KEYS) buckets[k] = []
    for (const p of filtered) {
      if (p.context && (CONTEXT_KEYS as readonly string[]).includes(p.context)) {
        buckets[p.context]!.push(p)
      } else {
        buckets.unclassified!.push(p)
      }
    }
    return buckets
  }, [filtered])

  const totals = useMemo(() => {
    const base = {
      projects: data?.length ?? 0,
      wip: 0,
      open: 0,
      epics: 0,
      shipped14d: 0,
      overdue: 0,
    }
    if (!data) return base
    for (const p of data) {
      base.wip += p.in_progress_count
      base.open += p.open_count
      base.epics += p.active_epic_count
      base.shipped14d += p.done_14d
      base.overdue += p.overdue_count
    }
    return base
  }, [data])

  if (isLoading) {
    return <div className="p-4 text-xs text-slate-500">Loading projects…</div>
  }
  if (error) {
    return <div className="p-4 text-xs text-red-400">Failed to load projects: {String(error)}</div>
  }

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4" style={{ background: 'var(--wf-bg)' }}>
      {/* Hero row — portfolio-level signals */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Metric label="Projects" value={totals.projects} tone="slate" />
        <Metric label="WIP" value={totals.wip} tone={totals.wip > 10 ? 'warn' : 'amber'} />
        <Metric label="Open" value={totals.open} tone="blue" />
        <Metric label="Active epics" value={totals.epics} tone="indigo" />
        <Metric label="Shipped 14d" value={totals.shipped14d} tone="emerald" />
        <Metric label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? 'warn' : 'slate'} />
      </section>

      {/* Filter + view toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">Life area</span>
          <SegmentedControl
            options={CONTEXT_FILTERS}
            value={contextFilter}
            onChange={setContextFilter}
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">View</span>
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      {/* Grouped content */}
      {([...CONTEXT_KEYS, 'unclassified'] as const).map((key) => {
        const items = grouped[key] ?? []
        if (items.length === 0) return null
        const display =
          key === 'unclassified'
            ? ContextToken.fallback.display
            : ContextToken.display[key as ContextKey]
        const accent =
          key === 'unclassified'
            ? ContextToken.fallback.accent
            : ContextToken.accent[key as ContextKey]
        return (
          <section key={key}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className={`text-[11px] font-semibold uppercase tracking-widest ${accent}`}>
                {display}
              </h2>
              <span className="text-[10px] text-slate-500">{items.length}</span>
            </div>
            {view === 'list' ? (
              <ProjectListTable items={items} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {items.map((p) => (
                  <ProjectInsightCard key={p.project_id} p={p} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {filtered.length === 0 && (
        <div className="text-xs text-slate-500 text-center py-8">No projects match this filter.</div>
      )}
    </div>
  )
}

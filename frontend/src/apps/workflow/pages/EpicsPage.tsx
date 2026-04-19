import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import type { RoadmapItem } from '../types'
import { TypeBadge } from '../components/ui/TypeBadge'
import { PriorityDot, PriorityBadge, ContextBadge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { ContextToken, CONTEXT_KEYS, type ContextKey } from '../lib/tokens'
import { formatAgeCoarse } from '../lib/time'
import { useUrlParam } from '../hooks/useUrlParam'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { treePath } from '../lib/urls'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

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

function resolveContext(item: RoadmapItem): string | null {
  return item.context ?? item.project_context ?? null
}

function daysStale(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

interface EpicCardProps {
  item: RoadmapItem
}

function EpicCard({ item }: EpicCardProps) {
  const progress = item.progress ?? { total: 0, done: 0, in_progress: 0, open: 0, percent: 0 }
  const childCount = item.children_count ?? 0
  const stale = daysStale(item.updated_at)
  const age = daysStale(item.created_at)
  const isStuck = stale > 14 && progress.in_progress === 0 && progress.total > 0 && progress.percent < 100
  const notStarted = progress.total > 0 && progress.percent === 0 && progress.in_progress === 0
  const nearDone = progress.total > 0 && progress.percent >= 80 && progress.percent < 100
  const context = resolveContext(item)

  return (
    <Link
      to={treePath(item.id, item.slug)}
      className="group block rounded-lg border p-3 transition-all hover:border-indigo-500/60"
      style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
    >
      {/* Row 1: type + id + priority + context */}
      <div className="flex items-center gap-2 mb-2">
        <TypeBadge type={item.type} />
        <span className="text-[10px] font-mono text-slate-500">#{item.id}</span>
        <PriorityDot priority={item.priority} />
        <span className="ml-auto"><ContextBadge context={context} /></span>
      </div>

      {/* Row 2: title */}
      <p className="text-sm font-semibold text-slate-100 leading-snug line-clamp-2 mb-2 group-hover:text-white">
        {item.title}
      </p>

      {/* Row 3: progress */}
      <div className="mb-2">
        <ProgressBar done={progress.done} total={progress.total} showCounts showPercent height={1.5} />
      </div>

      {/* Row 4: health flags */}
      <div className="flex flex-wrap gap-1 mb-2">
        {isStuck && (
          <span className="text-[10px] px-1.5 py-px rounded bg-red-900/40 text-red-300 border border-red-700/40">
            Stuck {stale}d
          </span>
        )}
        {notStarted && !isStuck && (
          <span className="text-[10px] px-1.5 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
            Not started
          </span>
        )}
        {nearDone && (
          <span className="text-[10px] px-1.5 py-px rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
            Near done
          </span>
        )}
        {progress.in_progress > 0 && (
          <span className="text-[10px] px-1.5 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
            {progress.in_progress} in flight
          </span>
        )}
        {progress.open > 0 && (
          <span className="text-[10px] px-1.5 py-px rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
            {progress.open} open
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span className="truncate">{item.project_name}</span>
        <span className="shrink-0">
          {childCount} {childCount === 1 ? 'child' : 'children'} · {age}d old · {formatAgeCoarse(item.updated_at)}
        </span>
      </div>
    </Link>
  )
}

type EpicStatusFlag = 'stuck' | 'not_started' | 'near_done' | 'in_flight' | 'idle'

function deriveEpicFlag(item: RoadmapItem): { key: EpicStatusFlag; label: string; cls: string } {
  const p = item.progress ?? { total: 0, done: 0, in_progress: 0, open: 0, percent: 0 }
  const stale = daysStale(item.updated_at)
  if (stale > 14 && p.in_progress === 0 && p.total > 0 && p.percent < 100) {
    return { key: 'stuck', label: `Stuck ${stale}d`, cls: 'bg-red-900/50 text-red-300 border border-red-700/50' }
  }
  if (p.total > 0 && p.percent >= 80 && p.percent < 100) {
    return { key: 'near_done', label: 'Near done', cls: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50' }
  }
  if (p.in_progress > 0) {
    return { key: 'in_flight', label: `${p.in_progress} in flight`, cls: 'bg-amber-900/50 text-amber-300 border border-amber-700/50' }
  }
  if (p.total > 0 && p.percent === 0) {
    return { key: 'not_started', label: 'Not started', cls: 'bg-amber-900/50 text-amber-300 border border-amber-700/50' }
  }
  return { key: 'idle', label: 'Idle', cls: 'bg-slate-800/60 text-slate-400 border border-slate-700/50' }
}

function EpicListRow({ item }: { item: RoadmapItem }) {
  const progress = item.progress ?? { total: 0, done: 0, in_progress: 0, open: 0, percent: 0 }
  const childCount = item.children_count ?? 0
  const age = daysStale(item.created_at)
  const context = resolveContext(item)
  const flag = deriveEpicFlag(item)

  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors">
      {/* ID + Title */}
      <td className="px-3 py-2">
        <Link to={treePath(item.id, item.slug)} className="group block">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500 shrink-0">#{item.id}</span>
            <span className="text-sm text-slate-100 group-hover:text-white line-clamp-1">
              {item.title}
            </span>
          </div>
        </Link>
      </td>

      {/* Type */}
      <td className="px-3 py-2"><TypeBadge type={item.type} /></td>

      {/* Priority */}
      <td className="px-3 py-2"><PriorityBadge priority={item.priority} /></td>

      {/* Context */}
      <td className="px-3 py-2"><ContextBadge context={context} /></td>

      {/* Project */}
      <td className="px-3 py-2 text-xs text-slate-400 truncate max-w-[140px]">
        {item.project_name}
      </td>

      {/* Flag */}
      <td className="px-3 py-2">
        <span className={`text-[10px] px-1.5 py-px rounded ${flag.cls}`}>{flag.label}</span>
      </td>

      {/* Progress */}
      <td className="px-3 py-2 min-w-[140px]">
        <ProgressBar done={progress.done} total={progress.total} showCounts showPercent height={1} />
      </td>

      {/* Counts */}
      <td className="px-3 py-2 text-center text-xs">
        <span className="tabular-nums text-slate-300">{childCount}</span>
      </td>
      <td className="px-3 py-2 text-center text-xs">
        <span className={`tabular-nums ${progress.in_progress > 0 ? 'text-amber-300 font-medium' : 'text-slate-600'}`}>
          {progress.in_progress}
        </span>
      </td>
      <td className="px-3 py-2 text-center text-xs">
        <span className={`tabular-nums ${progress.open > 0 ? 'text-blue-300' : 'text-slate-600'}`}>
          {progress.open}
        </span>
      </td>

      {/* Age + updated */}
      <td className="px-3 py-2 text-[10px] text-slate-400 whitespace-nowrap">{age}d</td>
      <td className="px-3 py-2 text-[10px] text-slate-400 whitespace-nowrap">
        {formatAgeCoarse(item.updated_at)}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Link
            to={treePath(item.id, item.slug)}
            className="text-[10px] px-1.5 py-px rounded bg-slate-800/80 text-slate-200 hover:bg-slate-700 border border-slate-700/60"
            title="Open tree view"
          >
            Tree
          </Link>
          <Link
            to={`/workflow?project=${encodeURIComponent(item.project_id)}`}
            className="text-[10px] px-1.5 py-px rounded bg-slate-800/80 text-slate-200 hover:bg-slate-700 border border-slate-700/60"
            title="Open task board for this project"
          >
            Tasks
          </Link>
        </div>
      </td>
    </tr>
  )
}

function EpicListTable({ items }: { items: RoadmapItem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800" style={{ background: 'var(--wf-bg-card)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800 bg-slate-900/40">
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">Context</th>
            <th className="px-3 py-2 font-medium">Project</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Progress</th>
            <th className="px-3 py-2 font-medium text-center" title="Total direct children">Kids</th>
            <th className="px-3 py-2 font-medium text-center" title="Tasks in progress">WIP</th>
            <th className="px-3 py-2 font-medium text-center" title="Open tasks">Open</th>
            <th className="px-3 py-2 font-medium">Age</th>
            <th className="px-3 py-2 font-medium">Updated</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => <EpicListRow key={item.id} item={item} />)}
        </tbody>
      </table>
    </div>
  )
}

function BucketSummary({ items, label }: { items: RoadmapItem[]; label: string }) {
  const stats = useMemo(() => {
    let wip = 0
    let stuck = 0
    let notStarted = 0
    let nearDone = 0
    let totalPct = 0
    let totalWithWork = 0
    for (const e of items) {
      const p = e.progress ?? { total: 0, done: 0, in_progress: 0, open: 0, percent: 0 }
      if (p.in_progress > 0) wip += 1
      const stale = daysStale(e.updated_at)
      if (stale > 14 && p.in_progress === 0 && p.total > 0 && p.percent < 100) stuck += 1
      if (p.total > 0 && p.percent === 0 && p.in_progress === 0) notStarted += 1
      if (p.total > 0 && p.percent >= 80 && p.percent < 100) nearDone += 1
      if (p.total > 0) {
        totalPct += p.percent
        totalWithWork += 1
      }
    }
    const avg = totalWithWork === 0 ? 0 : Math.round(totalPct / totalWithWork)
    return { wip, stuck, notStarted, nearDone, avg, count: items.length }
  }, [items])

  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
      <span>
        <span className="text-slate-200 font-medium">{stats.count}</span> {label}
      </span>
      <span className="text-slate-600">·</span>
      <span>Avg <span className="text-indigo-300 font-medium">{stats.avg}%</span></span>
      {stats.wip > 0 && <span className="text-amber-300">{stats.wip} WIP</span>}
      {stats.stuck > 0 && <span className="text-red-300">{stats.stuck} stuck</span>}
      {stats.notStarted > 0 && <span className="text-amber-300">{stats.notStarted} not started</span>}
      {stats.nearDone > 0 && <span className="text-emerald-300">{stats.nearDone} near done</span>}
    </div>
  )
}

export default function EpicsPage() {
  const [contextFilter, setContextFilter] = useUrlParam('context')
  const [projectFilter, setProjectFilter] = useUrlParam('project')
  const [typeFilter, setTypeFilter] = useUrlParam('type')
  const [view, setView] = useUrlParam('view', 'grid')

  const { data, isLoading, error } = useSWR<RoadmapItem[]>(
    '/workflow/api/roadmap',
    fetcher,
    { refreshInterval: 15000 },
  )

  const projects = useMemo(() => {
    if (!data) return []
    const seen = new Map<string, string>()
    for (const e of data) seen.set(e.project_id, e.project_name)
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false
      if (projectFilter && e.project_id !== projectFilter) return false
      const ctx = resolveContext(e)
      if (contextFilter === '__unclassified') return ctx == null
      if (contextFilter) return ctx === contextFilter
      return true
    })
  }, [data, typeFilter, projectFilter, contextFilter])

  const grouped = useMemo(() => {
    const buckets: Record<string, RoadmapItem[]> = { unclassified: [] }
    for (const k of CONTEXT_KEYS) buckets[k] = []
    for (const e of filtered) {
      const ctx = resolveContext(e)
      if (ctx && (CONTEXT_KEYS as readonly string[]).includes(ctx)) {
        buckets[ctx]!.push(e)
      } else {
        buckets.unclassified!.push(e)
      }
    }
    return buckets
  }, [filtered])

  if (isLoading) {
    return <div className="p-4 text-xs text-slate-500">Loading epics…</div>
  }
  if (error) {
    return <div className="p-4 text-xs text-red-400">Failed to load epics: {String(error)}</div>
  }
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-500">
        No active initiatives or epics. Create one with <code className="mx-1 px-1 bg-slate-800 rounded">tkt_add type=epic</code>.
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4" style={{ background: 'var(--wf-bg)' }}>
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">Life area</span>
          <SegmentedControl options={CONTEXT_FILTERS} value={contextFilter} onChange={setContextFilter} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">Type</span>
          <SegmentedControl
            options={[
              { value: '', label: 'All' },
              { value: 'initiative', label: 'Initiatives' },
              { value: 'epic', label: 'Epics' },
            ]}
            value={typeFilter}
            onChange={setTypeFilter}
          />
        </div>
        {projects.length > 1 && (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-gray-600"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">View</span>
          <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} />
          <span className="text-[10px] text-slate-500">
            {filtered.length} of {data.length}
          </span>
        </div>
      </div>

      {/* Grouped epic content */}
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
            <div className="flex items-center gap-3 mb-2">
              <h2 className={`text-[11px] font-semibold uppercase tracking-widest ${accent}`}>
                {display}
              </h2>
              <BucketSummary items={items} label={items.length === 1 ? 'epic' : 'epics'} />
            </div>
            {view === 'list' ? (
              <EpicListTable items={items} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {items.map((item) => (
                  <EpicCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {filtered.length === 0 && (
        <div className="text-xs text-slate-500 text-center py-8">No epics match these filters.</div>
      )}
    </div>
  )
}

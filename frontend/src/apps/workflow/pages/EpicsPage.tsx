import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import type { RoadmapItem } from '../types'
import { PriorityBadge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import {
  ContextToken,
  CONTEXT_KEYS,
  EpicSortFields,
  type ContextKey,
  type EpicSortFieldKey,
} from '../lib/tokens'
import { formatAgeCoarse } from '../lib/time'
import { useUrlParam } from '../hooks/useUrlParam'
import { useSortCriteria, type SortCriteriaConfig } from '../hooks/useSortCriteria'
import { applyEpicSorts, EPIC_DEFAULT_SORT } from '../lib/sort'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import SortBuilder from '../components/SortBuilder'
import BulkActions from '../components/BulkActions'
import { treePath } from '../lib/urls'

const EPIC_SORT_CONFIG: SortCriteriaConfig<EpicSortFieldKey> = {
  fields: EpicSortFields,
  defaultSort: EPIC_DEFAULT_SORT,
  storageKey: 'workflow.epicSortCriteria',
  urlParam: 'esort',
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const CONTEXT_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'work', label: ContextToken.display.work },
  { value: 'family', label: ContextToken.display.family },
  { value: 'personal', label: ContextToken.display.personal },
  { value: '__unclassified', label: 'Unclassified' },
]

function resolveContext(item: RoadmapItem): string | null {
  return item.context ?? item.project_context ?? null
}

function daysStale(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

/** Days threshold past which "no child activity" reads as stale rather than "active". */
const STALE_DAYS = 3

/**
 * Number of claimable descendants. `next_tasks` is capped at 3 by the API
 * (preview only) - the true count is `progress.open` (open+backlog leaves)
 * minus the ones that are blocked.
 */
function canStartCount(item: RoadmapItem): number {
  return Math.max(0, item.progress.open - item.blocked_count)
}

type EpicFlagKey = 'closeable' | 'not_started' | 'stale' | 'active'

interface EpicFlag {
  key: EpicFlagKey
  label: string
  cls: string
}

/**
 * ONE flag derivation, consumed by both the table row and the drawer header.
 * Priority: closeable > never-had-activity > stale > recently active.
 */
function deriveEpicFlag(item: RoadmapItem): EpicFlag {
  if (item.closeable) {
    return { key: 'closeable', label: 'close it', cls: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50' }
  }
  if (!item.last_child_activity_at) {
    return { key: 'not_started', label: 'not started', cls: 'bg-slate-800/60 text-slate-400 border border-slate-700/50' }
  }
  const stale = daysStale(item.last_child_activity_at)
  if (stale >= STALE_DAYS) {
    return {
      key: 'stale',
      label: `no child activity ${stale}d`,
      cls: 'bg-amber-900/50 text-amber-300 border border-amber-700/50',
    }
  }
  return {
    key: 'active',
    label: `child active ${formatAgeCoarse(item.last_child_activity_at)}`,
    cls: 'bg-sky-900/50 text-sky-300 border border-sky-700/50',
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard API unavailable (insecure context, permission denied) - silently no-op,
    // the button label already tells the user what would have been copied.
  }
}

function CopyClaimButton({ id }: { id: number }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation()
        await copyToClipboard(`tkt_claim ${id}`)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="text-[10px] px-1.5 py-px rounded bg-indigo-600/80 text-white hover:bg-indigo-500 shrink-0"
      title={`Copy: tkt_claim ${id}`}
    >
      {copied ? 'copied' : 'copy tkt_claim'}
    </button>
  )
}

// ── Table row ────────────────────────────────────────────────────────────

function EpicRow({
  item,
  selected,
  onSelect,
  checked,
  onToggleChecked,
}: {
  item: RoadmapItem
  selected: boolean
  onSelect: () => void
  checked: boolean
  onToggleChecked: (checked: boolean, shiftKey: boolean) => void
}) {
  const progress = item.progress
  const age = daysStale(item.created_at)
  const context = resolveContext(item)
  const flag = deriveEpicFlag(item)
  const running = item.in_flight.length
  const canStart = canStartCount(item)
  const display = context && (CONTEXT_KEYS as readonly string[]).includes(context)
    ? ContextToken.display[context as ContextKey]
    : ContextToken.fallback.display

  return (
    <tr
      onClick={onSelect}
      className={`border-b border-slate-800/60 cursor-pointer transition-colors ${
        selected ? 'bg-indigo-950/40 shadow-[inset_2px_0_0_0_theme(colors.indigo.500)]' : 'hover:bg-slate-900/40'
      }`}
    >
      <td className="px-3 py-2 w-8">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {}}
          onClick={(e) => {
            e.stopPropagation()
            onToggleChecked(!checked, e.shiftKey)
          }}
          className="shrink-0 accent-indigo-400 cursor-pointer"
          aria-label={`Select epic #${item.id}`}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500 shrink-0">#{item.id}</span>
          <span className="text-sm text-slate-100 line-clamp-1">{item.title}</span>
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {item.project_name} · <PriorityBadge priority={item.priority} /> · {display}
        </div>
      </td>

      <td className="px-3 py-2 text-xs whitespace-nowrap">
        <span className="text-sky-300 font-medium">{running} running</span>
        <span className="text-slate-600"> · </span>
        <span className="text-slate-200 font-medium">{canStart}</span>
        <span className="text-slate-500"> can start</span>
        {item.blocked_count > 0 && (
          <div className="text-[10px] text-slate-500 mt-0.5">{item.blocked_count} blocked</div>
        )}
      </td>

      <td className="px-3 py-2 min-w-[140px]">
        {progress.total > 0 ? (
          <ProgressBar done={progress.done} total={progress.total} showPercent height={1} />
        ) : (
          <span className="text-[11px] text-slate-600 italic">no children</span>
        )}
      </td>

      <td className="px-3 py-2">
        <span className={`text-[10px] px-1.5 py-px rounded ${flag.cls}`}>{flag.label}</span>
      </td>

      <td className="px-3 py-2 text-[10px] text-slate-400 whitespace-nowrap text-right">{age}d</td>
    </tr>
  )
}

function EpicTable({
  items,
  selectedId,
  onSelect,
  checkedIds,
  onToggleRow,
  onToggleAll,
}: {
  items: RoadmapItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  checkedIds: Set<number>
  onToggleRow: (id: number, checked: boolean, shiftKey: boolean) => void
  onToggleAll: (ids: number[], checked: boolean) => void
}) {
  const allChecked = items.length > 0 && items.every((i) => checkedIds.has(i.id))
  const someChecked = items.some((i) => checkedIds.has(i.id))

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800" style={{ background: 'var(--wf-bg-card)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800 bg-slate-900/40">
            <th className="px-3 py-2 font-medium w-8">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }}
                onChange={(e) => onToggleAll(items.map((i) => i.id), e.target.checked)}
                className="shrink-0 accent-indigo-400 cursor-pointer"
                aria-label="Select all epics in this group"
              />
            </th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Capacity</th>
            <th className="px-3 py-2 font-medium">Progress</th>
            <th className="px-3 py-2 font-medium">Flag</th>
            <th className="px-3 py-2 font-medium text-right">Age</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <EpicRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
              checked={checkedIds.has(item.id)}
              onToggleChecked={(checked, shiftKey) => onToggleRow(item.id, checked, shiftKey)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BucketSummary({ items, label }: { items: RoadmapItem[]; label: string }) {
  const stats = useMemo(() => {
    let running = 0
    let canStart = 0
    let closeable = 0
    let stale = 0
    for (const e of items) {
      running += e.in_flight.length
      canStart += canStartCount(e)
      if (e.closeable) closeable += 1
      if (deriveEpicFlag(e).key === 'stale') stale += 1
    }
    return { running, canStart, closeable, stale, count: items.length }
  }, [items])

  return (
    <div className="flex items-center gap-2 text-[10px] flex-wrap flex-1 min-w-0">
      <span className="text-slate-400">
        <span className="text-slate-200 font-medium">{stats.count}</span> {label}
      </span>
      <span className="px-1.5 py-px rounded-full bg-slate-800/60 text-sky-300 border border-slate-700/40">
        {stats.running} running
      </span>
      <span className="px-1.5 py-px rounded-full bg-slate-800/60 text-indigo-300 border border-slate-700/40">
        {stats.canStart} can start
      </span>
      {stats.closeable > 0 && (
        <span className="px-1.5 py-px rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
          {stats.closeable} closeable
        </span>
      )}
      {stats.stale > 0 && (
        <span className="px-1.5 py-px rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/40">
          {stats.stale} stale
        </span>
      )}
    </div>
  )
}

// ── Drawer ───────────────────────────────────────────────────────────────

function EpicDrawer({ item, onClose }: { item: RoadmapItem; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const canStart = canStartCount(item)
  const flag = deriveEpicFlag(item)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const visibleNextTasks = showAll ? item.next_tasks : item.next_tasks.slice(0, 3)

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed top-0 right-0 z-30 h-full w-full sm:w-[400px] flex flex-col shadow-2xl border-l"
        style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Epic detail"
      >
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b" style={{ borderColor: 'var(--wf-border)' }}>
          <div className="flex-1 min-w-0 mr-2">
            <p className="text-[10px] text-gray-500 mb-0.5">#{item.id}</p>
            <p className="text-sm font-medium text-gray-100 truncate">{item.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-5">
          <div className="flex flex-wrap gap-1.5 items-center">
            <PriorityBadge priority={item.priority} />
            <span className={`text-[10px] px-1.5 py-px rounded ${flag.cls}`}>{flag.label}</span>
          </div>

          {item.progress.total > 0 && (
            <div>
              <ProgressBar done={item.progress.done} total={item.progress.total} showCounts showPercent height={2} />
            </div>
          )}

          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
              Running now <span className="text-gray-400 normal-case tracking-normal">{item.in_flight.length}</span>
            </p>
            {item.in_flight.length === 0 ? (
              <p className="text-xs text-gray-600 italic">nothing running</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {item.in_flight.map((t) => (
                  <li key={t.id} className="rounded-lg px-2.5 py-1.5 border flex items-center gap-2" style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                    <span className="font-mono text-[10px] text-slate-500 shrink-0">#{t.id}</span>
                    <span className="flex-1 min-w-0 text-xs text-slate-200 truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
              Can start now <span className="text-gray-400 normal-case tracking-normal">{canStart}</span>
            </p>
            {item.next_tasks.length === 0 ? (
              <p className="text-xs text-gray-600 italic">nothing claimable</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1.5">
                  {visibleNextTasks.map((t) => (
                    <li key={t.id} className="rounded-lg px-2.5 py-1.5 border flex items-center gap-2" style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0">#{t.id}</span>
                      <span className="flex-1 min-w-0 text-xs text-slate-200 truncate">{t.title}</span>
                      <CopyClaimButton id={t.id} />
                    </li>
                  ))}
                </ul>
                {!showAll && canStart > item.next_tasks.length && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="mt-1.5 text-[11px] text-indigo-400 hover:text-indigo-300"
                  >
                    {item.next_tasks.length < canStart
                      ? `Preview only shows top ${item.next_tasks.length} of ${canStart}`
                      : `Show all ${canStart}`}
                  </button>
                )}
              </>
            )}
          </div>

          {item.blocked_count > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                Blocked <span className="text-gray-400 normal-case tracking-normal">{item.blocked_count}</span>
              </p>
              <p className="text-xs text-gray-500">
                {item.blocked_count} {item.blocked_count === 1 ? 'task has' : 'tasks have'} an unmet dependency.
              </p>
            </div>
          )}

          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Epic operations</p>
            <div className="grid grid-cols-2 gap-1.5">
              <Link
                to={treePath(item.id, item.slug)}
                className="text-[11px] px-2 py-1.5 rounded border text-center text-slate-300 hover:text-white hover:border-slate-600"
                style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
              >
                Open tree
              </Link>
              <Link
                to={`/workflow?project=${encodeURIComponent(item.project_id)}&parent=${item.id}&status=all`}
                className="text-[11px] px-2 py-1.5 rounded border text-center text-slate-300 hover:text-white hover:border-slate-600"
                style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
              >
                All tasks
              </Link>
              <button
                onClick={() => copyToClipboard(`tkt_done ${item.id}`)}
                className="col-span-2 text-[11px] px-2 py-1.5 rounded border text-center text-emerald-300 hover:text-emerald-200 hover:border-emerald-700"
                style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
                title={`Copy: tkt_done ${item.id}`}
              >
                Close epic (copy tkt_done)
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function EpicsPage() {
  const [contextFilter, setContextFilter] = useUrlParam('context')
  const [projectFilter, setProjectFilter] = useUrlParam('project')
  const [typeFilter, setTypeFilter] = useUrlParam('type')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<number | null>(null)
  const sortController = useSortCriteria(EPIC_SORT_CONFIG)

  // Selection clears when the filter changes - a checked id from outside the
  // new filtered set would silently carry a bulk action onto rows the operator
  // can no longer see. Cleared at the point the filter actually changes (not in
  // an effect) so it isn't a second render reacting to the first.
  const clearSelection = () => {
    setCheckedIds(new Set())
    setLastClickedId(null)
  }
  const handleContextFilterChange = (v: string) => { setContextFilter(v); clearSelection() }
  const handleProjectFilterChange = (v: string) => { setProjectFilter(v); clearSelection() }
  const handleTypeFilterChange = (v: string) => { setTypeFilter(v); clearSelection() }

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
    // Apply user's sort criteria within each context bucket (preserves grouping).
    for (const key of Object.keys(buckets)) {
      buckets[key] = applyEpicSorts(buckets[key]!, sortController.criteria)
    }
    return buckets
  }, [filtered, sortController.criteria])

  const selectedItem = useMemo(
    () => (selectedId == null ? null : (data?.find((e) => e.id === selectedId) ?? null)),
    [data, selectedId],
  )

  // Flattened id order matching what's actually painted (grouped buckets, each sorted),
  // so shift-click range selection follows what the operator sees on screen.
  const renderOrder = useMemo(() => {
    const ids: number[] = []
    for (const key of [...CONTEXT_KEYS, 'unclassified'] as const) {
      for (const item of grouped[key] ?? []) ids.push(item.id)
    }
    return ids
  }, [grouped])

  const handleToggleRow = (id: number, checked: boolean, shiftKey: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (shiftKey && lastClickedId != null) {
        const from = renderOrder.indexOf(lastClickedId)
        const to = renderOrder.indexOf(id)
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from]
          for (let i = lo; i <= hi; i++) {
            const rid = renderOrder[i]
            if (rid !== undefined) {
              if (checked) next.add(rid)
              else next.delete(rid)
            }
          }
          return next
        }
      }
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
    setLastClickedId(id)
  }

  const handleToggleAll = (ids: number[], checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

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
    <div className="h-full overflow-y-auto p-4 lg:p-6 flex flex-col gap-4 md:gap-5 lg:gap-5" style={{ background: 'var(--wf-bg)' }}>
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">Life area</span>
          <SegmentedControl options={CONTEXT_FILTERS} value={contextFilter} onChange={handleContextFilterChange} />
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
            onChange={handleTypeFilterChange}
          />
        </div>
        {projects.length > 1 && (
          <select
            value={projectFilter}
            onChange={(e) => handleProjectFilterChange(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-gray-600"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-slate-500">
            {filtered.length} of {data.length}
          </span>
        </div>
      </div>

      {/* Sort builder - reorders within each context bucket */}
      <div className="rounded-lg border" style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}>
        <SortBuilder controller={sortController} fields={EpicSortFields} />
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
            <div className="flex items-center gap-3 mb-2 lg:mb-3">
              <h2 className={`text-[11px] lg:text-xs font-semibold uppercase tracking-widest ${accent}`}>
                {display}
              </h2>
              <BucketSummary items={items} label={items.length === 1 ? 'epic' : 'epics'} />
            </div>
            <EpicTable
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              checkedIds={checkedIds}
              onToggleRow={handleToggleRow}
              onToggleAll={handleToggleAll}
            />
          </section>
        )
      })}

      {filtered.length === 0 && (
        <div className="text-xs text-slate-500 text-center py-8">No epics match these filters.</div>
      )}

      {selectedItem && <EpicDrawer item={selectedItem} onClose={() => setSelectedId(null)} />}

      <BulkActions
        selectedIds={checkedIds}
        projects={[]}
        onClearSelection={() => setCheckedIds(new Set())}
        enabledActions={['priority']}
      />
    </div>
  )
}

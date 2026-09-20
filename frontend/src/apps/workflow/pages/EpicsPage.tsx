import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import type { RoadmapItem, TreeNode } from '../types'
import { PriorityBadge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { CapacityReadout } from '../components/ui/CapacityReadout'
import { FlagChip } from '../components/ui/FlagChip'
import { CopyButton } from '../components/ui/CopyButton'
import { copyToClipboard } from '../lib/clipboard'
import { IconButton } from '../components/ui/IconButton'
import { ResizeHandle } from '../components/ui/ResizeHandle'
import { CloseIcon, ChevronLeftIcon } from '../components/ui/icons'
import { TreeRow } from '../components/common/TreeRow'
import { TaskDetailPanelContent } from '../components/TaskDetailDrawer'
import { MultiSelectChips } from '../components/ui/MultiSelectChips'
import { useResizableDrawerWidth } from '../hooks/useResizableDrawerWidth'
import { useLazySubtree } from '../hooks/useLazySubtree'
import {
  ContextToken,
  CONTEXT_KEYS,
  EpicSortFields,
  Priority,
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

const EPIC_DRAWER_WIDTH_STORAGE_KEY = 'workflow.epicsDrawerWidth'
const EPIC_DRAWER_DEFAULT_WIDTH = 480
const EPIC_DRAWER_MIN_WIDTH = 320
const EPIC_DRAWER_MAX_WIDTH = 900
const EPIC_DRAWER_MAX_VIEWPORT_RATIO = 0.6

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
  return Math.max(0, item.progress.open - (item.blocked_count ?? 0))
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
  if (item.closeable ?? false) {
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
  const capacityUnknown = item.in_flight === undefined && item.next_tasks === undefined
  const running = item.in_flight?.length ?? 0
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
          <span className="text-xs font-mono text-slate-400 shrink-0">#{item.id}</span>
          <span className="text-sm text-slate-100 line-clamp-1">{item.title}</span>
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
          {item.project_name} · <PriorityBadge priority={item.priority} /> · {display}
        </div>
      </td>

      <td className="px-3 py-2 text-xs">
        <CapacityReadout
          running={running}
          canStart={canStart}
          blockedCount={item.blocked_count ?? 0}
          unknown={capacityUnknown}
        />
      </td>

      <td className="px-3 py-2 min-w-[140px]">
        {progress.total > 0 ? (
          <ProgressBar done={progress.done} total={progress.total} showPercent height={1} />
        ) : (
          <span className="text-xs text-slate-400 italic">no children</span>
        )}
      </td>

      <td className="px-3 py-2">
        <FlagChip flag={flag} />
      </td>

      <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap text-right">{age}d</td>
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
      <table className="w-full text-xs table-fixed">
        <colgroup>
          <col className="w-8" />
          <col />
          <col className="w-44" />
          <col className="w-40" />
          <col className="w-36" />
          <col className="w-14" />
        </colgroup>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800 bg-slate-900/40">
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
      running += e.in_flight?.length ?? 0
      canStart += canStartCount(e)
      if (e.closeable ?? false) closeable += 1
      if (deriveEpicFlag(e).key === 'stale') stale += 1
    }
    return { running, canStart, closeable, stale, count: items.length }
  }, [items])

  return (
    <div className="flex items-center gap-2 text-xs flex-wrap flex-1 min-w-0">
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

// ── Inline subtree (drawer "Open tree" section) ─────────────────────────
//
// Reuses the same TreeRow/TreeConnector the dedicated /workflow/tree/:id
// page renders with, but flattens starting at the *children* of the root
// (the root itself is already shown in the drawer header) so depth 0 here
// matches TreeConnector's "top-level, no connector" case.

interface FlatTreeRow {
  node: TreeNode
  depth: number
  isLast: boolean
  ancestorFlags: readonly boolean[]
}

function flattenChildren(
  children: TreeNode[],
  expanded: Set<number>,
  depth: number,
  ancestorFlags: readonly boolean[],
): FlatTreeRow[] {
  const out: FlatTreeRow[] = []
  children.forEach((child, i) => {
    const isLast = i === children.length - 1
    out.push({ node: child, depth, isLast, ancestorFlags })
    const grandchildren = child.children ?? []
    if (expanded.has(child.id) && grandchildren.length > 0) {
      const nextAncestors = depth === 0 ? [] : [...ancestorFlags, isLast]
      out.push(...flattenChildren(grandchildren, expanded, depth + 1, nextAncestors))
    }
  })
  return out
}

function EpicTreeSection({
  item,
  open,
  onToggleOpen,
  subtreeData,
  subtreeError,
  subtreeLoading,
  onOpenTask,
}: {
  item: RoadmapItem
  open: boolean
  onToggleOpen: () => void
  subtreeData: TreeNode | undefined
  subtreeError: unknown
  subtreeLoading: boolean
  /** Opens a task from the tree in-place, inside the drawer's view stack. */
  onOpenTask: (id: number) => void
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set())

  const toggleNode = (id: number) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const rows = useMemo(() => {
    if (!subtreeData) return [] as FlatTreeRow[]
    return flattenChildren(subtreeData.children ?? [], expandedNodes, 0, [])
  }, [subtreeData, expandedNodes])

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <button
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-wider hover:text-gray-200 transition-colors"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Subtree <span className="text-gray-300 normal-case tracking-normal">{item.children_count}</span>
        </button>
        <Link
          to={treePath(item.id, item.slug)}
          className="text-xs text-slate-500 hover:text-slate-200 transition-colors"
          title="Open dedicated tree page"
        >
          open full page ↗
        </Link>
      </div>
      {open && (
        <div className="rounded-lg border px-1 py-1" style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}>
          {subtreeLoading && <p className="text-xs text-gray-400 italic px-2 py-1.5">Loading subtree…</p>}
          {!subtreeLoading && subtreeError !== undefined && (
            <p className="text-xs text-red-400 px-2 py-1.5">Failed to load subtree.</p>
          )}
          {!subtreeLoading && subtreeError === undefined && subtreeData && rows.length === 0 && (
            <p className="text-xs text-gray-400 italic px-2 py-1.5">No children.</p>
          )}
          {!subtreeLoading && subtreeError === undefined && rows.length > 0 && (
            <div className="flex flex-col">
              {rows.map((row) => (
                <TreeRow
                  key={row.node.id}
                  node={row.node}
                  depth={row.depth}
                  isLast={row.isLast}
                  ancestorFlags={row.ancestorFlags}
                  expanded={expandedNodes.has(row.node.id)}
                  onToggle={toggleNode}
                  onSelect={onOpenTask}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Drawer view stack (epic -> task -> task) ────────────────────────────
//
// The drawer never navigates the page - opening a task from the epic (or a
// task's own children/siblings) pushes a view onto a small in-memory stack
// instead. Escape always closes the whole drawer; the back control pops one
// level. Re-opening a task already on the stack jumps back to it rather than
// pushing a duplicate, which is what keeps a cyclic ancestor from looping.

type EpicDrawerView = { kind: 'epic' } | { kind: 'task'; id: number }

const EPIC_DRAWER_MAX_STACK_DEPTH = 25

function EpicDrawerBreadcrumb({
  epicTitle,
  stack,
  onJump,
  onBack,
}: {
  epicTitle: string
  stack: EpicDrawerView[]
  onJump: (index: number) => void
  onBack: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0 border-b overflow-x-auto" style={{ borderColor: 'var(--wf-border)' }}>
      <IconButton icon={<ChevronLeftIcon size={11} />} onClick={onBack} ariaLabel="Back one level" />
      <nav aria-label="Drawer navigation" className="flex items-center gap-1 text-xs text-slate-400 min-w-0">
        {stack.map((view, i) => {
          const isLast = i === stack.length - 1
          const label = view.kind === 'epic' ? epicTitle : <DrawerBreadcrumbTaskLabel id={view.id} />
          return (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span aria-hidden="true">›</span>}
              {isLast ? (
                <span className="text-slate-200 truncate max-w-[160px] inline-block align-bottom">{label}</span>
              ) : (
                <button onClick={() => onJump(i)} className="hover:text-slate-100 transition-colors truncate max-w-[160px] inline-block align-bottom">
                  {label}
                </button>
              )}
            </span>
          )
        })}
      </nav>
    </div>
  )
}

/** SWR is keyed by the same URL TaskDetailPanelContent fetches, so a task
 * already visited resolves from cache with no extra request. */
function DrawerBreadcrumbTaskLabel({ id }: { id: number }) {
  const { data } = useSWR<{ task: { title: string } }>(`/workflow/api/tasks/${id}/detail`, fetcher)
  return <>{data ? `#${id} ${data.task.title}` : `#${id}`}</>
}

function EpicDrawer({ item, onClose }: { item: RoadmapItem; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [stack, setStack] = useState<EpicDrawerView[]>([{ kind: 'epic' }])
  const canStart = canStartCount(item)
  const flag = deriveEpicFlag(item)

  // Lazy fetch of /api/tree/:id - only once the tree section is first opened.
  const { data: subtreeResp, error: subtreeError, isLoading: subtreeLoading } = useLazySubtree(item.id, treeOpen)
  const { width, min, max, isDragging, handleProps } = useResizableDrawerWidth({
    storageKey: EPIC_DRAWER_WIDTH_STORAGE_KEY,
    defaultWidth: EPIC_DRAWER_DEFAULT_WIDTH,
    min: EPIC_DRAWER_MIN_WIDTH,
    maxAbsolute: EPIC_DRAWER_MAX_WIDTH,
    maxViewportRatio: EPIC_DRAWER_MAX_VIEWPORT_RATIO,
  })

  // Escape always closes the whole drawer, regardless of stack depth - the
  // back control (not Escape) is what steps up one level.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const top = stack[stack.length - 1]!

  const openTask = (id: number) => {
    setStack((prev) => {
      const existingIdx = prev.findIndex((v) => v.kind === 'task' && v.id === id)
      if (existingIdx !== -1) return prev.slice(0, existingIdx + 1)
      if (prev.length >= EPIC_DRAWER_MAX_STACK_DEPTH) return prev
      return [...prev, { kind: 'task', id }]
    })
  }
  const goBack = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  const jumpTo = (index: number) => setStack((prev) => prev.slice(0, index + 1))

  const inFlight = item.in_flight ?? []
  const nextTasks = item.next_tasks ?? []
  const blockedCount = item.blocked_count ?? 0
  const visibleNextTasks = showAll ? nextTasks : nextTasks.slice(0, 3)

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed top-0 right-0 z-30 h-full w-full sm:w-[var(--epic-drawer-width)] flex flex-col shadow-2xl border-l"
        style={{
          background: 'var(--wf-bg-surface)',
          borderColor: 'var(--wf-border)',
          '--epic-drawer-width': `${width}px`,
        } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label="Epic detail"
      >
        <ResizeHandle
          isDragging={isDragging}
          ariaLabel="Resize epic detail drawer"
          valueNow={width}
          valueMin={min}
          valueMax={max}
          {...handleProps}
        />

        {stack.length > 1 && (
          <EpicDrawerBreadcrumb epicTitle={item.title} stack={stack} onJump={jumpTo} onBack={goBack} />
        )}

        {top.kind === 'task' ? (
          <TaskDetailPanelContent
            key={top.id}
            taskId={top.id}
            onClose={onClose}
            onNavigate={openTask}
            onOpenChild={openTask}
          />
        ) : (
          <>
            <div className="flex items-start justify-between px-4 py-3 shrink-0 border-b gap-2" style={{ borderColor: 'var(--wf-border)' }}>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 mb-0.5">#{item.id}</p>
                <p className="text-sm font-medium text-gray-100 break-words">{item.title}</p>
              </div>
              <IconButton
                icon={<CloseIcon size={12} />}
                onClick={onClose}
                ariaLabel="Close drawer"
                className="mt-0.5 shrink-0"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-5">
              <div className="flex flex-wrap gap-1.5 items-center">
                <PriorityBadge priority={item.priority} />
                <FlagChip flag={flag} />
              </div>

              {item.progress.total > 0 && (
                <div>
                  <ProgressBar done={item.progress.done} total={item.progress.total} showCounts showPercent height={2} />
                </div>
              )}

              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                  Running now <span className="text-gray-300 normal-case tracking-normal">{inFlight.length}</span>
                </p>
                {inFlight.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">nothing running</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {inFlight.map((t) => (
                      <li key={t.id}>
                        <button
                          onClick={() => openTask(t.id)}
                          className="w-full rounded-lg px-2.5 py-1.5 border flex items-start gap-2 text-left hover:border-indigo-500/40 transition-colors"
                          style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0 mt-1.5" />
                          <span className="font-mono text-xs text-slate-400 shrink-0">#{t.id}</span>
                          <span className="flex-1 min-w-0 text-xs text-slate-200 break-words">{t.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                  Can start now <span className="text-gray-300 normal-case tracking-normal">{canStart}</span>
                </p>
                {nextTasks.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">nothing claimable</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-1.5">
                      {visibleNextTasks.map((t) => (
                        <li key={t.id} className="rounded-lg px-2.5 py-1.5 border flex items-start gap-2" style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}>
                          <button
                            onClick={() => openTask(t.id)}
                            className="flex-1 min-w-0 flex items-start gap-2 text-left"
                          >
                            <span className="font-mono text-xs text-slate-400 shrink-0">#{t.id}</span>
                            <span className="flex-1 min-w-0 text-xs text-slate-200 break-words">{t.title}</span>
                          </button>
                          <CopyButton command={`tkt_claim ${t.id}`} label="copy tkt_claim" />
                        </li>
                      ))}
                    </ul>
                    {!showAll && canStart > nextTasks.length && (
                      <button
                        onClick={() => {
                          // next_tasks is capped at 3 by the API - there is nothing
                          // more to reveal from it. The real "see the rest" is the
                          // subtree section below, fed by the uncapped /api/tree
                          // response.
                          if (nextTasks.length < canStart) setTreeOpen(true)
                          else setShowAll(true)
                        }}
                        className="mt-1.5 text-xs text-indigo-400 hover:text-indigo-300"
                      >
                        {nextTasks.length < canStart
                          ? `Preview only shows top ${nextTasks.length} of ${canStart} - see the subtree below`
                          : `Show all ${canStart}`}
                      </button>
                    )}
                  </>
                )}
              </div>

              {blockedCount > 0 && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                    Blocked <span className="text-gray-300 normal-case tracking-normal">{blockedCount}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {blockedCount} {blockedCount === 1 ? 'task has' : 'tasks have'} an unmet dependency.
                  </p>
                </div>
              )}

              <EpicTreeSection
                item={item}
                open={treeOpen}
                onToggleOpen={() => setTreeOpen((v) => !v)}
                subtreeData={subtreeResp?.tree}
                subtreeError={subtreeError}
                subtreeLoading={subtreeLoading}
                onOpenTask={openTask}
              />

              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Epic operations</p>
                <button
                  onClick={() => copyToClipboard(`tkt_done ${item.id}`)}
                  className="w-full text-xs px-2 py-1.5 rounded border text-center text-emerald-300 hover:text-emerald-200 hover:border-emerald-700"
                  style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}
                  title={`Copy: tkt_done ${item.id}`}
                >
                  Close epic (copy tkt_done)
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function EpicsPage() {
  const [contextFilter, setContextFilter] = useUrlParam('context')
  const [projectFilter, setProjectFilter] = useUrlParam('project')
  const [typeFilter, setTypeFilter] = useUrlParam('type')
  const [priorityFilterRaw, setPriorityFilterRaw] = useUrlParam('priority')
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

  // Multi-select, comma-separated in the URL (matches the other filters'
  // useUrlParam pattern). Empty = no priority filtering (initial state).
  const priorityFilter = useMemo(
    () => (priorityFilterRaw ? priorityFilterRaw.split(',').filter(Boolean) : []),
    [priorityFilterRaw],
  )
  const handlePriorityFilterChange = (next: string[]) => {
    setPriorityFilterRaw(next.join(','))
    clearSelection()
  }

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

  // Options are derived from the priorities actually present in the loaded
  // data, not a hardcoded list - tasks.priority is free TEXT with no CHECK
  // constraint and the live table has dirty values (e.g. a priority equal to
  // a project_id). Known priorities sort first in urgency order; anything
  // unrecognized is listed after rather than silently dropped.
  const priorityOptions = useMemo(() => {
    if (!data) return []
    const present = new Set(data.map((e) => e.priority))
    const known = (Object.keys(Priority.order) as Array<keyof typeof Priority.order>).filter((p) => present.has(p))
    const unknown = [...present].filter((p) => !Object.hasOwn(Priority.order, p)).sort()
    return [...known, ...unknown].map((value) => ({
      value,
      label: Priority.display[value as keyof typeof Priority.display] ?? value,
      activeCls: Priority.badge[value as keyof typeof Priority.badge],
    }))
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false
      if (projectFilter && e.project_id !== projectFilter) return false
      if (priorityFilter.length > 0 && !priorityFilter.includes(e.priority)) return false
      const ctx = resolveContext(e)
      if (contextFilter === '__unclassified') return ctx == null
      if (contextFilter) return ctx === contextFilter
      return true
    })
  }, [data, typeFilter, projectFilter, priorityFilter, contextFilter])

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
    <div className="h-full overflow-y-auto p-4 lg:p-6 flex flex-col gap-4 md:gap-5 lg:gap-5" style={{ background: 'var(--wf-bg-base)' }}>
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 uppercase tracking-widest">Life area</span>
          <SegmentedControl options={CONTEXT_FILTERS} value={contextFilter} onChange={handleContextFilterChange} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 uppercase tracking-widest">Type</span>
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
        {priorityOptions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase tracking-widest">Priority</span>
            <MultiSelectChips
              options={priorityOptions}
              selected={priorityFilter}
              onChange={handlePriorityFilterChange}
            />
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-400">
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
              <h2 className={`text-xs font-semibold uppercase tracking-widest ${accent}`}>
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

      {selectedItem && (
        <EpicDrawer key={selectedItem.id} item={selectedItem} onClose={() => setSelectedId(null)} />
      )}

      <BulkActions
        selectedIds={checkedIds}
        projects={[]}
        onClearSelection={() => setCheckedIds(new Set())}
        enabledActions={['priority']}
      />
    </div>
  )
}

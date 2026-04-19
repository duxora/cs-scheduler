/**
 * Tree view page at /workflow/tree/:id. Shows the full subtree of an
 * initiative or epic with expand/collapse, status glyphs, and inline
 * progress. Includes a hero strip with rollup + parent breadcrumb.
 */

import { useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import useSWR from 'swr'
import type { TreeResponse, TreeNode } from '../types'
import { TypeBadge } from '../components/ui/TypeBadge'
import { StatusBadge, PriorityBadge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { TreeRow } from '../components/common/TreeRow'
import { ParentBreadcrumb } from '../components/common/ParentBreadcrumb'
import TaskDetailDrawer from '../components/TaskDetailDrawer'
import { CloseIcon } from '../components/ui/icons'
import { parseIdFromRef } from '../lib/urls'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
})

interface FlatRow {
  node: TreeNode
  depth: number
  isLast: boolean
  ancestorFlags: readonly boolean[]
}

/** Flatten the tree in DFS order, respecting the expanded set. */
function flatten(
  root: TreeNode,
  expanded: Set<number>,
  depth: number,
  isLast: boolean,
  ancestorFlags: readonly boolean[],
): FlatRow[] {
  const out: FlatRow[] = [{ node: root, depth, isLast, ancestorFlags }]
  if (!expanded.has(root.id)) return out
  const children = root.children ?? []
  children.forEach((child, i) => {
    const childIsLast = i === children.length - 1
    const nextAncestors = depth === 0 ? [] : [...ancestorFlags, isLast]
    out.push(...flatten(child, expanded, depth + 1, childIsLast, nextAncestors))
  })
  return out
}

export default function TaskTreePage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const id = parseIdFromRef(params.id) ?? NaN

  const { data, error } = useSWR<TreeResponse>(
    Number.isFinite(id) ? `/workflow/api/tree/${id}` : null,
    fetcher,
    { refreshInterval: 5000 },
  )

  // Default: root expanded; all other parent nodes collapsed.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set<number>())
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null)

  const handleToggle = useCallback((nodeId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const rows = useMemo(() => {
    if (!data) return [] as FlatRow[]
    // Auto-expand root so the user sees the first layer immediately.
    const rootExpanded = new Set(expanded)
    rootExpanded.add(data.tree.id)
    return flatten(data.tree, rootExpanded, 0, true, [])
  }, [data, expanded])

  const expandAll = useCallback(() => {
    if (!data) return
    const all = new Set<number>()
    const walk = (n: TreeNode) => {
      if (n.children && n.children.length > 0) {
        all.add(n.id)
        n.children.forEach(walk)
      }
    }
    walk(data.tree)
    setExpanded(all)
  }, [data])

  const collapseAll = useCallback(() => setExpanded(new Set()), [])

  if (!Number.isFinite(id)) {
    return (
      <div className="p-4 text-sm text-red-400">Invalid task id.</div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400">
        Failed to load tree. <Link to="/workflow" className="underline hover:text-red-300">Back to tasks</Link>
      </div>
    )
  }

  if (!data) {
    return <div className="p-4 text-xs text-slate-500">Loading tree…</div>
  }

  const root = data.tree
  const progress = root.progress

  return (
    <div className="flex flex-col h-full text-slate-100" style={{ background: 'var(--wf-bg-base)' }}>

      {/* Hero header */}
      <header
        className="shrink-0 border-b px-5 py-4"
        style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            {data.ancestors.length > 0 && (
              <div className="mb-1.5">
                <ParentBreadcrumb ancestors={data.ancestors} />
              </div>
            )}
            <div className="flex items-center gap-2 mb-1">
              <TypeBadge type={root.type} />
              <span className="text-[10px] font-mono text-slate-500">#{root.id}</span>
              <StatusBadge status={root.status} />
              <PriorityBadge priority={root.priority} />
            </div>
            <h1 className="text-lg font-semibold text-white leading-snug">{root.title}</h1>
          </div>
          <button
            onClick={() => navigate('/workflow')}
            className="shrink-0 text-slate-500 hover:text-slate-200 transition-colors w-7 h-7 flex items-center justify-center rounded hover:bg-slate-800/60"
            aria-label="Back to tasks"
            title="Back to tasks"
          >
            <CloseIcon />
          </button>
        </div>

        {progress && progress.total > 0 && (
          <div className="mt-3">
            <ProgressBar
              done={progress.done}
              total={progress.total}
              showCounts
              showPercent
              height={2}
            />
            <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
              <span><span className="text-emerald-400 font-medium">{progress.done}</span> done</span>
              <span><span className="text-amber-400 font-medium">{progress.in_progress}</span> in flight</span>
              <span><span className="text-blue-400 font-medium">{progress.open}</span> open</span>
              <span className="text-slate-500">· {progress.total} total leaves</span>
            </div>
          </div>
        )}
      </header>

      {/* Toolbar */}
      <div
        className="shrink-0 flex items-center gap-2 px-5 py-2 border-b"
        style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}
      >
        <button
          onClick={expandAll}
          className="text-[11px] px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
        >
          Expand all
        </button>
        <button
          onClick={collapseAll}
          className="text-[11px] px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
        >
          Collapse all
        </button>
        <span className="ml-auto text-[11px] text-slate-500">
          {rows.length} row{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {rows.length === 0 && (
          <p className="text-xs text-slate-500 px-2 py-4">No descendants.</p>
        )}
        <div className="flex flex-col">
          {rows.map(({ node, depth, isLast, ancestorFlags }) => (
            <TreeRow
              key={node.id}
              node={node}
              depth={depth}
              expanded={expanded.has(node.id) || node.id === root.id}
              isLast={isLast}
              ancestorFlags={ancestorFlags}
              onToggle={handleToggle}
              onSelect={(nodeId) => setDrawerTaskId(nodeId)}
            />
          ))}
        </div>
      </div>

      {/* Shared drawer — reused from TaskBoard */}
      <TaskDetailDrawer
        taskId={drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onNavigate={setDrawerTaskId}
      />
    </div>
  )
}

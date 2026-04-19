/**
 * One row of a tree view — status glyph + id + type badge + title + progress + due.
 * Handles expand/collapse via a chevron when the node has children. Left-pads
 * using TreeConnector so siblings line up visually.
 *
 * This component is stateless — the parent owns the expanded set.
 */

import { Link } from 'react-router-dom'
import type { TreeNode } from '../../types'
import { TypeBadge } from '../ui/TypeBadge'
import { StatusGlyph } from '../ui/StatusGlyph'
import { TreeConnector } from '../ui/TreeConnector'
import { ProgressBar } from '../ui/ProgressBar'
import { PriorityDot } from '../ui/Badge'
import { treePath } from '../../lib/urls'

interface TreeRowProps {
  node: TreeNode
  depth: number
  expanded: boolean
  isLast: boolean
  ancestorFlags: readonly boolean[]
  onToggle: (id: number) => void
  /** Opens the task drawer on the same page (tasks list) or detail view */
  onSelect?: (id: number) => void
}

export function TreeRow({
  node,
  depth,
  expanded,
  isLast,
  ancestorFlags,
  onToggle,
  onSelect,
}: TreeRowProps) {
  const hasChildren = node.children && node.children.length > 0

  return (
    <div
      className="group flex items-center gap-2 py-1.5 pr-3 rounded hover:bg-slate-800/40 transition-colors"
    >
      <TreeConnector depth={depth} isLast={isLast} ancestorFlags={ancestorFlags} />

      {/* Chevron (or spacer for leaves) */}
      {hasChildren ? (
        <button
          onClick={() => onToggle(node.id)}
          className="shrink-0 w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-100 transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      ) : (
        <span className="shrink-0 w-4" aria-hidden="true" />
      )}

      <StatusGlyph status={node.status} />
      <PriorityDot priority={node.priority} />
      <span className="text-[10px] font-mono text-slate-500 shrink-0">#{node.id}</span>
      <TypeBadge type={node.type} />

      <button
        className="flex-1 min-w-0 text-left text-[13px] text-slate-100 truncate hover:text-white transition-colors"
        onClick={() => onSelect?.(node.id)}
        title={node.title}
      >
        {node.title}
      </button>

      {node.progress && node.progress.total > 0 && (
        <div className="w-28 shrink-0 hidden md:block">
          <ProgressBar
            done={node.progress.done}
            total={node.progress.total}
            showCounts
            showPercent={false}
            height={1}
          />
        </div>
      )}

      <Link
        to={treePath(node.id, node.slug)}
        className="text-[10px] text-slate-500 hover:text-slate-200 transition-colors shrink-0 hidden sm:inline"
        onClick={(e) => e.stopPropagation()}
        title="Open tree"
      >
        open →
      </Link>
    </div>
  )
}

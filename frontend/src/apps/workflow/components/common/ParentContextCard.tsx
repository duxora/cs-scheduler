/**
 * Stacked parent/root context card for the task detail drawer. Shows the
 * immediate parent (and top-level root if the hierarchy goes deeper) with
 * mini progress bar — helps orient a leaf task inside its initiative/epic.
 */

import { Link } from 'react-router-dom'
import type { TaskRef, ProgressSummary } from '../../types'
import { TypeBadge } from '../ui/TypeBadge'
import { ProgressBar } from '../ui/ProgressBar'
import { treePath } from '../../lib/urls'

interface ParentContextCardProps {
  parent: TaskRef
  root?: TaskRef | null
  /** Progress on the immediate parent — if available */
  parentProgress?: ProgressSummary
  /** Progress on the root ancestor — if available */
  rootProgress?: ProgressSummary
}

function Row({
  label,
  ref,
  progress,
}: {
  label: string
  ref: TaskRef
  progress?: ProgressSummary
}) {
  return (
    <Link
      to={treePath(ref.id, ref.slug)}
      className="flex flex-col gap-1 rounded-md border px-2.5 py-2 transition-colors hover:border-indigo-500/40"
      style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</span>
        <TypeBadge type={ref.type} />
        <span className="text-[10px] font-mono text-slate-500">#{ref.id}</span>
      </div>
      <p className="text-xs text-slate-200 leading-snug line-clamp-1">{ref.title}</p>
      {progress && progress.total > 0 && (
        <ProgressBar
          done={progress.done}
          total={progress.total}
          showCounts
          showPercent={false}
          height={1}
        />
      )}
    </Link>
  )
}

export function ParentContextCard({ parent, root, parentProgress, rootProgress }: ParentContextCardProps) {
  const showRoot = root && root.id !== parent.id

  return (
    <div className="flex flex-col gap-1.5">
      {showRoot && <Row label="Root" ref={root} progress={rootProgress} />}
      <Row label={showRoot ? 'Parent' : 'Parent'} ref={parent} progress={parentProgress} />
    </div>
  )
}

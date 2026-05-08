/**
 * Hero card for an initiative or epic. Shown on the dashboard "Initiatives &
 * Epics" strip. Wraps the Type/Priority/Progress atoms in a clickable surface
 * that opens the task's tree view.
 */

import { Link } from 'react-router-dom'
import type { RoadmapItem, Task } from '../../types'
import { TypeBadge } from '../ui/TypeBadge'
import { PriorityDot } from '../ui/Badge'
import { ProgressBar } from '../ui/ProgressBar'
import { treePath } from '../../lib/urls'

interface InitiativeCardProps {
  item: Pick<
    RoadmapItem | Task,
    'id' | 'title' | 'type' | 'priority' | 'status' | 'project_name' | 'domain' | 'due_date'
  > & {
    slug?: string | null
    children_count?: number
    progress?: { total: number; done: number; in_progress: number; open: number; percent: number }
  }
}

function formatDue(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export function InitiativeCard({ item }: InitiativeCardProps) {
  const progress = item.progress ?? { total: 0, done: 0, in_progress: 0, open: 0, percent: 0 }
  const due = formatDue(item.due_date)

  return (
    <Link
      to={treePath(item.id, item.slug)}
      className="group shrink-0 block rounded-lg border p-2 transition-all hover:border-indigo-500/50"
      style={{
        background: 'var(--wf-bg-card)',
        borderColor: 'var(--wf-border)',
        minWidth: '190px',
        maxWidth: '220px',
      }}
    >
      {/* Row 1: type + id + priority dot */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <TypeBadge type={item.type} />
        <span className="text-[10px] font-mono text-slate-500">#{item.id}</span>
        <PriorityDot priority={item.priority} />
        {due && (
          <span className="ml-auto text-[10px] text-slate-400 shrink-0">Due {due}</span>
        )}
      </div>

      {/* Row 2: title */}
      <p className="text-xs font-semibold text-slate-100 leading-snug line-clamp-1 mb-1.5 group-hover:text-white transition-colors">
        {item.title}
      </p>

      {/* Row 3: progress bar + meta inline */}
      <div className="mb-1">
        <ProgressBar
          done={progress.done}
          total={progress.total}
          showCounts
          showPercent
          height={1.5}
        />
      </div>

      {/* Row 4: project + open count */}
      <div className="flex items-center gap-1.5 mt-1">
        {progress.open > 0 && (
          <span className="text-[10px] px-1.5 py-px rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
            {progress.open} open
          </span>
        )}
        {item.project_name && (
          <span className="ml-auto text-[10px] text-slate-500 truncate">
            {item.project_name}
          </span>
        )}
      </div>
    </Link>
  )
}

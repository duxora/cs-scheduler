/**
 * Breadcrumb trail showing a task's ancestor chain, most-distant first.
 * Each segment is a clickable chip that opens that ancestor's tree view.
 *
 * The ancestors array from the API is ordered [immediate_parent, grandparent, ...]
 * so we reverse it for display so the root appears on the left.
 */

import { Link } from 'react-router-dom'
import type { TaskRef } from '../../types'
import { TypeDot } from '../ui/TypeBadge'
import { treePath } from '../../lib/urls'

interface ParentBreadcrumbProps {
  ancestors: TaskRef[]
  className?: string
}

export function ParentBreadcrumb({ ancestors, className = '' }: ParentBreadcrumbProps) {
  if (ancestors.length === 0) return null

  // API returns nearest-parent first; reverse so root appears on the left.
  const chain = [...ancestors].reverse()

  return (
    <nav
      aria-label="Parent breadcrumb"
      className={`flex items-center gap-1 text-[11px] text-slate-400 flex-wrap ${className}`}
    >
      {chain.map((a, idx) => (
        <span key={a.id} className="flex items-center gap-1">
          <Link
            to={treePath(a.id, a.slug)}
            className="flex items-center gap-1 px-1.5 py-px rounded hover:bg-slate-800/80 hover:text-slate-100 transition-colors"
            title={a.title}
          >
            <TypeDot type={a.type} />
            <span className="font-mono text-slate-500">#{a.id}</span>
            <span className="truncate max-w-[140px]">{a.title}</span>
          </Link>
          {idx < chain.length - 1 && (
            <span className="text-slate-600" aria-hidden="true">›</span>
          )}
        </span>
      ))}
    </nav>
  )
}

import { Link } from 'react-router-dom'
import type { Task } from '../types'
import { Priority, isParentType } from '../lib/tokens'
import { PriorityDot, StatusBadge } from './ui/Badge'
import { TypeBadge } from './ui/TypeBadge'
import { ProgressBar } from './ui/ProgressBar'
import { TrashIcon, GridIcon, ExternalLinkIcon } from './ui/icons'
import { treePath } from '../lib/urls'

interface TaskRowProps {
  task: Task
  selected: boolean
  onSelect: (id: number, checked: boolean) => void
  onOpenDetail: (id: number) => void
  onDelete: (id: number) => Promise<void>
}

export default function TaskRow({ task, selected, onSelect, onOpenDetail, onDelete }: TaskRowProps) {
  const stripe = Priority.stripe[task.priority as keyof typeof Priority.stripe] ?? Priority.fallback.stripe
  const isParent = isParentType(task.type)
  const showProgress = isParent && task.progress && task.progress.total > 0

  return (
    <div
      className={`
        group/row flex items-center gap-2.5 pl-2.5 pr-3 py-2.5
        rounded-lg border-l-2 border border-transparent
        transition-all duration-100 cursor-default
        ${stripe}
        ${selected ? 'border-slate-600/60' : 'border-transparent'}
      `}
      style={{ background: selected ? 'var(--wf-bg-hover)' : undefined }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--wf-bg-card)' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = '' }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelect(task.id, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 accent-blue-400 cursor-pointer"
        aria-label={`Select task #${task.id}`}
      />

      {/* ID */}
      <span className="text-[12px] text-slate-300 font-mono shrink-0 w-10 text-right">
        #{task.id}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Title: priority dot + title button */}
        <div className="flex items-center gap-1.5">
          <PriorityDot priority={task.priority} />
          <button
            className="text-[13px] font-medium text-slate-100 text-left hover:text-white transition-colors line-clamp-1 leading-snug"
            onClick={() => onOpenDetail(task.id)}
          >
            {task.title}
          </button>
        </div>

        {/* Parent breadcrumb chip — only when this task has a parent */}
        {task.parent_id != null && (
          <Link
            to={treePath(task.parent_id!)}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 pl-3 text-[10px] text-slate-400 hover:text-indigo-300 w-fit transition-colors"
            title="View parent tree"
          >
            <span className="text-slate-600" aria-hidden="true">↳</span>
            <span>parent #{task.parent_id}</span>
          </Link>
        )}

        {/* Progress row — shown only for parent-type rows with progress */}
        {showProgress && task.progress && (
          <div className="pl-3 flex items-center gap-2 max-w-md">
            <ProgressBar
              done={task.progress.done}
              total={task.progress.total}
              showCounts
              showPercent
              height={1}
            />
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2 pl-3">
          {isParent && <TypeBadge type={task.type} />}
          <StatusBadge status={task.status} pill />
          <span className="flex items-center gap-1 text-[12px] text-slate-200 font-medium shrink-0">
            <GridIcon />
            <span className="truncate max-w-[140px]">{task.project_name ?? task.project_id}</span>
          </span>
          {task.domain && (
            <span className="text-[11px] text-slate-400 font-medium hidden sm:inline truncate max-w-[100px] lg:max-w-[160px]">
              {task.domain}
            </span>
          )}
          {task.phase && (
            <span className="text-[10px] text-slate-500 hidden lg:inline bg-slate-800/60 px-1.5 py-px rounded border border-slate-700/40">
              {task.phase}
            </span>
          )}
          {task.pr_number != null && (
            <a
              href={`https://github.com/search?q=${encodeURIComponent(task.branch ?? String(task.pr_number))}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-0.5 text-[10px] text-blue-400/70 hover:text-blue-300 font-medium transition-colors hidden sm:inline-flex"
            >
              PR#{task.pr_number}
              <ExternalLinkIcon size={8} />
            </a>
          )}
          <span className={`text-[11px] font-medium ml-auto hidden md:inline ${Priority.label[task.priority as keyof typeof Priority.label] ?? Priority.fallback.label}`}>
            {Priority.display[task.priority as keyof typeof Priority.display] ?? task.priority}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center">
        <button
          onClick={async (e) => {
            e.stopPropagation()
            if (confirm(`Delete task #${task.id}?\n"${task.title}"\n\nThis cannot be undone.`)) {
              await onDelete(task.id)
            }
          }}
          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded-md transition-all"
          title="Delete task"
          aria-label={`Delete task #${task.id}`}
        >
          <TrashIcon size={13} />
        </button>
      </div>
    </div>
  )
}

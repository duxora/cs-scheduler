/**
 * SortPill — single sort criterion as an interactive pill.
 *
 * Generic over field-key type `F` so it can drive task, project, and epic
 * sort toolbars from the same atom.
 */

import { ArrowDownIcon, ArrowUpIcon, CloseIcon, GripVerticalIcon } from './icons'
import type { SortDirection, SortFieldDef } from '../../lib/tokens'

interface SortPillProps<F extends string> {
  field: F
  dir: SortDirection
  position: number
  total: number
  fieldMap: Record<F, SortFieldDef<F>>
  isDragging?: boolean
  isDropTarget?: boolean
  onToggleDir: (field: F) => void
  onRemove: (field: F) => void
  onDragStart: (field: F) => void
  onDragOver: (field: F) => void
  onDragEnd: () => void
}

export function SortPill<F extends string>({
  field,
  dir,
  position,
  total,
  fieldMap,
  isDragging,
  isDropTarget,
  onToggleDir,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
}: SortPillProps<F>) {
  const def = fieldMap[field]!
  const isPrimary = position === 1
  const dirLabel = dir === 'asc' ? 'ascending' : 'descending'
  const dirArrow = dir === 'asc'
    ? <ArrowUpIcon size={9} className="text-slate-300" />
    : <ArrowDownIcon size={9} className="text-slate-300" />

  const baseClasses = isPrimary
    ? 'border-blue-700/60 bg-blue-950/40 text-blue-100'
    : 'border-slate-700/60 bg-slate-800/80 text-slate-200'

  const dropClasses = isDropTarget
    ? 'ring-1 ring-blue-400/70 ring-offset-1 ring-offset-slate-900'
    : ''

  const draggingClasses = isDragging ? 'opacity-40 scale-95' : 'opacity-100'

  return (
    <div
      role="group"
      aria-label={`Sort by ${def.label}, ${dirLabel}, position ${position} of ${total}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', field)
        onDragStart(field)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver(field)
      }}
      onDrop={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      className={`
        inline-flex items-center gap-1 pl-1 pr-1.5 py-1 rounded-full border
        text-[11px] font-medium select-none transition-all
        ${baseClasses} ${dropClasses} ${draggingClasses}
      `}
    >
      <span
        className="cursor-grab text-slate-500 hover:text-slate-200 active:cursor-grabbing px-0.5"
        aria-hidden="true"
        title="Drag to reorder"
      >
        <GripVerticalIcon size={11} />
      </span>

      <span
        className={`
          inline-flex items-center justify-center min-w-[14px] h-[14px] px-1
          rounded-full text-[9px] font-bold tabular-nums
          ${isPrimary ? 'bg-blue-500/80 text-white' : 'bg-slate-700 text-slate-300'}
        `}
        aria-hidden="true"
      >
        {position}
      </span>

      <button
        type="button"
        onClick={() => onToggleDir(field)}
        className="inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
        aria-label={`${def.label} ${dirLabel}. Click to flip direction.`}
      >
        <span>{def.label}</span>
        {dirArrow}
      </button>

      <button
        type="button"
        onClick={() => onRemove(field)}
        className="ml-0.5 w-4 h-4 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-white hover:bg-red-500/40 transition-colors"
        aria-label={`Remove ${def.label} sort`}
      >
        <CloseIcon size={8} />
      </button>
    </div>
  )
}

/**
 * SortBuilder — composable multi-criteria sort surface.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ SORT  [⠿ 1 Status ↑ ✕] [⠿ 2 Updated ↓ ✕]   [+ Add sort]   Reset   │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Interaction model
 *  - Drag a pill to reorder → leftmost = highest precedence.
 *  - Click pill body → flip asc/desc.
 *  - "+ Add sort" → menu of unused fields with their default direction.
 *  - "Reset" → restore default sort (only visible when modified).
 *  - All operations are state-only — TaskBoard does the actual sorting.
 *
 * Accessibility
 *  - Whole strip is `role="toolbar" aria-label="Sort criteria"`.
 *  - Each pill announces its field, direction, and position via aria-label.
 *  - A polite live region announces sort changes for screen readers.
 *
 * Why HTML5 native drag-and-drop instead of dnd-kit:
 *  Pills are short and the list is small (<=6 fields). Native DnD is zero
 *  bundle cost and behaves correctly with mouse + trackpad. Touch users get
 *  the keyboard fallback through the field menu.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { SortPill } from './ui/SortPill'
import { PlusIcon, CloseIcon } from './ui/icons'
import { SortFields, type SortFieldKey } from '../lib/tokens'
import type { UseSortCriteriaReturn } from '../hooks/useSortCriteria'

interface SortBuilderProps {
  controller: UseSortCriteriaReturn
}

export default function SortBuilder({ controller }: SortBuilderProps) {
  const { criteria, add, remove, toggleDir, reorder, reset } = controller
  const [menuOpen, setMenuOpen] = useState(false)
  const [draggingField, setDraggingField] = useState<SortFieldKey | null>(null)
  const [dropTarget, setDropTarget] = useState<SortFieldKey | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Fields not yet in use — drives the "+ Add sort" menu.
  const unusedFields = useMemo(
    () => SortFields.filter((f) => !criteria.some((c) => c.field === f.key)),
    [criteria],
  )

  // Update live region whenever criteria change so SR users hear the new order.
  useEffect(() => {
    if (criteria.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnnouncement('Sort cleared.')
      return
    }
    const parts = criteria.map((c) => `${c.field.replace('_at', '')} ${c.dir}ending`)
    setAnnouncement(`Sorted by ${parts.join(', then ')}.`)
  }, [criteria])

  // Click-outside to close the add-sort menu.
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleDragStart = (field: SortFieldKey) => setDraggingField(field)
  const handleDragOver  = (field: SortFieldKey) => setDropTarget(field)
  const handleDragEnd   = () => {
    if (draggingField && dropTarget && draggingField !== dropTarget) {
      reorder(draggingField, dropTarget)
    }
    setDraggingField(null)
    setDropTarget(null)
  }

  const isModified = !(
    criteria.length === 3
    && criteria[0]?.field === 'status'     && criteria[0]?.dir === 'asc'
    && criteria[1]?.field === 'priority'   && criteria[1]?.dir === 'asc'
    && criteria[2]?.field === 'updated_at' && criteria[2]?.dir === 'desc'
  )

  return (
    <div
      role="toolbar"
      aria-label="Sort criteria"
      className="flex flex-wrap items-center gap-1.5 px-4 py-2 shrink-0 border-b"
      style={{ borderColor: 'var(--wf-border)' }}
    >
      <span className="text-[11px] text-slate-200 font-semibold uppercase tracking-widest mr-1 shrink-0">
        Sort
      </span>

      {criteria.length === 0 && (
        <span className="text-[11px] text-slate-300 italic">No sort applied — rows in API order</span>
      )}

      {criteria.map((c, i) => (
        <SortPill
          key={c.field}
          field={c.field}
          dir={c.dir}
          position={i + 1}
          total={criteria.length}
          isDragging={draggingField === c.field}
          isDropTarget={dropTarget === c.field && draggingField !== null && draggingField !== c.field}
          onToggleDir={toggleDir}
          onRemove={remove}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        />
      ))}

      {/* + Add sort */}
      {unusedFields.length > 0 && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-slate-700 hover:border-blue-500/60 hover:bg-blue-950/30 text-[11px] text-slate-400 hover:text-blue-200 transition-all"
            aria-label="Add sort criterion"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <PlusIcon size={9} />
            Add sort
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full mt-1 z-30 min-w-[180px] rounded-lg border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur p-1"
            >
              {unusedFields.map((f) => (
                <button
                  key={f.key}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    add(f.key)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded text-[11px] text-slate-300 hover:bg-blue-900/40 hover:text-blue-100 transition-colors flex items-center justify-between gap-3"
                >
                  <span>{f.menuLabel}</span>
                  <span className="text-[10px] text-slate-400 uppercase">{f.defaultDir}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reset */}
      {isModified && (
        <button
          type="button"
          onClick={reset}
          className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-slate-300 hover:text-red-300 px-2 py-1 rounded-full border border-slate-700/50 hover:border-red-800/50 transition-all"
          aria-label="Reset sort to default"
        >
          <CloseIcon size={9} />
          Reset
        </button>
      )}

      {/* SR-only live region */}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  )
}

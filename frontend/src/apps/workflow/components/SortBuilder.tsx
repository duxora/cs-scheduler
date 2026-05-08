/**
 * SortBuilder — composable multi-criteria sort surface.
 *
 * Generic over field-key type `F`. Caller supplies the field list and the
 * criteria controller (from `useSortCriteria`).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { SortPill } from './ui/SortPill'
import { PlusIcon, CloseIcon } from './ui/icons'
import type { SortFieldDef } from '../lib/tokens'
import type { UseSortCriteriaReturn } from '../hooks/useSortCriteria'

interface SortBuilderProps<F extends string> {
  controller: UseSortCriteriaReturn<F>
  fields: readonly SortFieldDef<F>[]
  /** When true, renders inline (no row wrapper/border) for embedding inside FilterBar */
  compact?: boolean
}

export default function SortBuilder<F extends string>({
  controller,
  fields,
  compact = false,
}: SortBuilderProps<F>) {
  const { criteria, add, remove, toggleDir, reorder, reset, isModified } = controller
  const [menuOpen, setMenuOpen] = useState(false)
  const [draggingField, setDraggingField] = useState<F | null>(null)
  const [dropTarget, setDropTarget] = useState<F | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const menuRef = useRef<HTMLDivElement | null>(null)

  const fieldMap = useMemo(
    () => fields.reduce(
      (acc, f) => { acc[f.key] = f; return acc },
      {} as Record<F, SortFieldDef<F>>,
    ),
    [fields],
  )

  const unusedFields = useMemo(
    () => fields.filter((f) => !criteria.some((c) => c.field === f.key)),
    [fields, criteria],
  )

  useEffect(() => {
    if (criteria.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnnouncement('Sort cleared.')
      return
    }
    const parts = criteria.map((c) => `${c.field.replace('_at', '')} ${c.dir}ending`)
    setAnnouncement(`Sorted by ${parts.join(', then ')}.`)
  }, [criteria])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleDragStart = (field: F) => setDraggingField(field)
  const handleDragOver  = (field: F) => setDropTarget(field)
  const handleDragEnd   = () => {
    if (draggingField && dropTarget && draggingField !== dropTarget) {
      reorder(draggingField, dropTarget)
    }
    setDraggingField(null)
    setDropTarget(null)
  }

  const inner = (
    <>
      <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-widest shrink-0">
        Sort
      </span>

      {criteria.length === 0 && (
        <span className="text-[11px] text-slate-500 italic">default</span>
      )}

      {criteria.map((c, i) => (
        <SortPill<F>
          key={c.field}
          field={c.field}
          dir={c.dir}
          position={i + 1}
          total={criteria.length}
          fieldMap={fieldMap}
          isDragging={draggingField === c.field}
          isDropTarget={dropTarget === c.field && draggingField !== null && draggingField !== c.field}
          onToggleDir={toggleDir}
          onRemove={remove}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        />
      ))}

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

      {isModified && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-0.5 text-[11px] text-slate-300 hover:text-red-300 px-2 py-1 rounded-full border border-slate-700/50 hover:border-red-800/50 transition-all"
          aria-label="Reset sort to default"
        >
          <CloseIcon size={9} />
          Reset
        </button>
      )}

      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  )

  if (compact) {
    return (
      <>
        <div aria-hidden="true" className="h-4 w-px bg-slate-700/60 mx-0.5 shrink-0" />
        {inner}
      </>
    )
  }

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
      {inner}
    </div>
  )
}

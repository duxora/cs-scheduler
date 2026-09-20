/**
 * Drag handle for a resizable side panel - a thin strip on the panel's edge
 * that brightens on hover/drag, with cursor: col-resize. Keyboard-operable
 * (role="separator" + arrow keys via onKeyDown) so the resize affordance
 * isn't drag-only. Purely presentational; the parent owns drag state and
 * clamping via useResizableDrawerWidth.
 */

import type { KeyboardEvent, PointerEvent } from 'react'

interface ResizeHandleProps {
  isDragging: boolean
  ariaLabel: string
  valueNow: number
  valueMin: number
  valueMax: number
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}

export function ResizeHandle({
  isDragging,
  ariaLabel,
  valueNow,
  valueMin,
  valueMax,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      className={`absolute left-0 top-0 -translate-x-1/2 h-full w-1.5 cursor-col-resize touch-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400 ${
        isDragging ? 'bg-indigo-500/70' : 'bg-transparent hover:bg-indigo-500/40'
      }`}
    />
  )
}

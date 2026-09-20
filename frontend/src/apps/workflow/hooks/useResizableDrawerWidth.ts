import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

interface UseResizableDrawerWidthOptions {
  /** localStorage key the resolved width is persisted under. */
  storageKey: string
  defaultWidth: number
  min: number
  /** Absolute upper bound in px (before the viewport-ratio cap is applied). */
  maxAbsolute: number
  /** Upper bound as a fraction of the viewport width, e.g. 0.6 for 60vw. */
  maxViewportRatio: number
  /** px per arrow-key press. */
  step?: number
  /** px per shift+arrow / Home-End press. */
  largeStep?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeMax(maxViewportRatio: number, maxAbsolute: number): number {
  if (typeof window === 'undefined') return maxAbsolute
  return Math.min(maxAbsolute, Math.round(window.innerWidth * maxViewportRatio))
}

function readStored(storageKey: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw == null) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback
    return parsed
  } catch {
    // private mode / blocked storage - fall back to the default, never break render
    return fallback
  }
}

function writeStored(storageKey: string, value: number): void {
  try {
    window.localStorage.setItem(storageKey, String(value))
  } catch {
    // ignore - resize still works for the rest of this session
  }
}

function setBodyUserSelect(value: string): void {
  try {
    document.body.style.userSelect = value
  } catch {
    // ignore - non-browser or locked-down environment
  }
}

/**
 * Drag-to-resize width for a side drawer, anchored on its LEFT edge (drag
 * left widens, drag right narrows). Persists to localStorage, clamps to
 * [min, min(maxAbsolute, maxViewportRatio * vw)], and exposes keyboard
 * stepping so the resize affordance isn't drag-only.
 */
export function useResizableDrawerWidth({
  storageKey,
  defaultWidth,
  min,
  maxAbsolute,
  maxViewportRatio,
  step = 16,
  largeStep = 64,
}: UseResizableDrawerWidthOptions) {
  const [max, setMax] = useState<number>(() => computeMax(maxViewportRatio, maxAbsolute))
  const [width, setWidth] = useState<number>(() => {
    const initialMax = computeMax(maxViewportRatio, maxAbsolute)
    return readStored(storageKey, clamp(defaultWidth, min, initialMax), min, initialMax)
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(Math.round(next), min, max)
      setWidth(clamped)
      writeStored(storageKey, clamped)
    },
    [min, max, storageKey],
  )

  useEffect(() => {
    const onViewportResize = () => {
      const nextMax = computeMax(maxViewportRatio, maxAbsolute)
      setMax(nextMax)
      setWidth((w) => clamp(w, min, nextMax))
    }
    window.addEventListener('resize', onViewportResize)
    return () => window.removeEventListener('resize', onViewportResize)
  }, [maxViewportRatio, maxAbsolute, min])

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragStartX.current = e.clientX
      dragStartWidth.current = width
      setIsDragging(true)
      setBodyUserSelect('none')
    },
    [width],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      // Handle sits on the drawer's left edge: moving left (negative dx) widens it.
      const dx = e.clientX - dragStartX.current
      commit(dragStartWidth.current - dx)
    },
    [isDragging, commit],
  )

  const endDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setIsDragging(false)
    setBodyUserSelect('')
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        commit(width + (e.shiftKey ? largeStep : step))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        commit(width - (e.shiftKey ? largeStep : step))
      } else if (e.key === 'Home') {
        e.preventDefault()
        commit(max)
      } else if (e.key === 'End') {
        e.preventDefault()
        commit(min)
      }
    },
    [commit, width, step, largeStep, min, max],
  )

  return {
    width,
    min,
    max,
    isDragging,
    handleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown: handleKeyDown,
    },
  }
}

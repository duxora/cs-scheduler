/**
 * Task type badge/dot atoms. Mirrors the Priority/Status badge pattern —
 * reads from Type tokens with an `Object.hasOwn` fallback so future type
 * values render a neutral slate pill instead of breaking the layout.
 */

import { Type } from '../../lib/tokens'

interface TypeBadgeProps {
  type: string
  className?: string
}

export function TypeBadge({ type, className = '' }: TypeBadgeProps) {
  const key = type as keyof typeof Type.badge
  const cls = Object.hasOwn(Type.badge, key) ? Type.badge[key] : Type.fallback.badge
  const labelKey = type as keyof typeof Type.display
  const label = Object.hasOwn(Type.display, labelKey) ? Type.display[labelKey] : type
  return (
    <span className={`text-[10px] px-1.5 py-px rounded font-medium uppercase tracking-wide ${cls} ${className}`}>
      {label}
    </span>
  )
}

interface TypeDotProps {
  type: string
  title?: string
  size?: number
}

export function TypeDot({ type, title, size = 6 }: TypeDotProps) {
  const key = type as keyof typeof Type.dot
  const cls = Object.hasOwn(Type.dot, key) ? Type.dot[key] : Type.fallback.dot
  return (
    <span
      className={`shrink-0 rounded-full ${cls}`}
      style={{ width: size, height: size }}
      title={title ?? type}
    />
  )
}

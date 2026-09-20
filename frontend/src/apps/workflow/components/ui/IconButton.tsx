/**
 * Icon button atom - a small square hit-target for a single SVG icon
 * (close, settings, ...). Default colors meet WCAG AA (>= 3:1) against every
 * --wf-bg-surface/--wf-bg-card theme value; do not drop back to gray-500/600.
 */

import type { ReactNode } from 'react'

interface IconButtonProps {
  icon: ReactNode
  onClick: () => void
  ariaLabel: string
  className?: string
}

export function IconButton({ icon, onClick, ariaLabel, className = '' }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className={`text-slate-400 hover:text-white transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 ${className}`}
    >
      {icon}
    </button>
  )
}

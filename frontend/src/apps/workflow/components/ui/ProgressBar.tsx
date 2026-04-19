/**
 * Rollup progress bar atom. Shows a gradient fill proportional to done/total,
 * with optional "N/M" and percent labels. Used on initiative/epic rows.
 */

interface ProgressBarProps {
  done: number
  total: number
  /** When true, renders "N/M" to the right of the bar */
  showCounts?: boolean
  /** When true, renders "NN%" to the right of the bar */
  showPercent?: boolean
  /** Track height in tailwind units (default 1 = 0.25rem) */
  height?: 1 | 1.5 | 2
  /** Additional classes on the wrapper */
  className?: string
}

export function ProgressBar({
  done,
  total,
  showCounts = false,
  showPercent = true,
  height = 1.5,
  className = '',
}: ProgressBarProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const heightCls = height === 1 ? 'h-1' : height === 2 ? 'h-2' : 'h-1.5'

  // Completed runs get a softer emerald; in-flight gets a crisp blue→purple gradient.
  const fillCls = pct === 100
    ? 'bg-emerald-500'
    : 'bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`flex-1 ${heightCls} rounded-full bg-slate-800 overflow-hidden`} aria-hidden={total === 0}>
        <div
          className={`${heightCls} rounded-full ${fillCls} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showCounts && (
        <span className="text-[10px] font-mono text-slate-400 shrink-0 tabular-nums">
          {done}/{total}
        </span>
      )}
      {showPercent && (
        <span className="text-[10px] font-medium text-slate-300 shrink-0 tabular-nums w-8 text-right">
          {pct}%
        </span>
      )}
    </div>
  )
}

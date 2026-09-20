/**
 * Capacity readout atom - "N running · M can start" with an optional
 * blocked-count line underneath. Renders a dash when the backend didn't
 * send in_flight/next_tasks (older API response shape).
 */

interface CapacityReadoutProps {
  running: number
  canStart: number
  blockedCount?: number
  unknown?: boolean
  className?: string
}

export function CapacityReadout({
  running,
  canStart,
  blockedCount = 0,
  unknown = false,
  className = '',
}: CapacityReadoutProps) {
  if (unknown) {
    return <span className={`text-slate-400 ${className}`}>-</span>
  }
  return (
    <div className={className}>
      <span className="text-sky-300 font-medium">{running} running</span>
      <span className="text-slate-500"> · </span>
      <span className="text-slate-200 font-medium">{canStart}</span>
      <span className="text-slate-400"> can start</span>
      {blockedCount > 0 && (
        <div className="text-xs text-slate-400 mt-0.5">{blockedCount} blocked</div>
      )}
    </div>
  )
}

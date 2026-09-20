/**
 * Flag chip atom - renders a derived-status label (closeable / stale / active /
 * not started) with its pre-resolved color classes. Used on the epic table row
 * and the epic drawer header so both read the exact same flag.
 */

export interface FlagChipData {
  label: string
  cls: string
}

interface FlagChipProps {
  flag: FlagChipData
  className?: string
}

export function FlagChip({ flag, className = '' }: FlagChipProps) {
  return (
    <span className={`text-xs px-1.5 py-px rounded ${flag.cls} ${className}`}>
      {flag.label}
    </span>
  )
}

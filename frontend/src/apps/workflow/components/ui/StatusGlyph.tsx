/**
 * Compact status indicator rendered as a unicode glyph, color-keyed via the
 * Status tokens. Used in tree/list views where a full badge is too heavy.
 *
 *   done        → ✓  emerald
 *   in_progress → ⏵  amber
 *   open        → ○  blue
 *   backlog     → ○  indigo (hollower)
 */

interface StatusGlyphProps {
  status: string
  className?: string
}

const GLYPH: Record<string, string> = {
  done:        '✓',
  in_progress: '⏵',
  open:        '○',
  backlog:     '◌',
}

const COLOR: Record<string, string> = {
  done:        'text-emerald-400',
  in_progress: 'text-amber-400',
  open:        'text-blue-400',
  backlog:     'text-indigo-400',
}

export function StatusGlyph({ status, className = '' }: StatusGlyphProps) {
  const glyph = Object.hasOwn(GLYPH, status) ? GLYPH[status] : '•'
  const color = Object.hasOwn(COLOR, status) ? COLOR[status] : 'text-slate-500'
  return (
    <span
      className={`inline-block w-3 text-center font-mono leading-none ${color} ${className}`}
      aria-label={status}
      title={status.replace('_', ' ')}
    >
      {glyph}
    </span>
  )
}

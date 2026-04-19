/**
 * Tree indentation connector glyphs. Renders the visual "rails" that connect
 * a nested TreeRow to its parent. Depth controls how many pass-through "│"
 * columns render before the branch joint.
 *
 *   depth=0           →  (nothing — root)
 *   depth=1, last=no  →  ├─
 *   depth=1, last=yes →  └─
 *   depth=2, last=no  →  │  ├─
 */

interface TreeConnectorProps {
  depth: number
  /** True if this node is the last child in its sibling group */
  isLast?: boolean
  /**
   * Stack of ancestor "isLast" flags, oldest→immediate. Each "true" draws a
   * blank column (no vertical line), each "false" draws a "│" pass-through.
   * If omitted, all ancestor columns draw "│" (safe default — slight visual
   * clutter but never wrong).
   */
  ancestorFlags?: readonly boolean[]
}

export function TreeConnector({ depth, isLast = false, ancestorFlags }: TreeConnectorProps) {
  if (depth <= 0) return null

  const columns: string[] = []
  const flags = ancestorFlags ?? Array(Math.max(0, depth - 1)).fill(false)
  for (let i = 0; i < depth - 1; i++) {
    columns.push(flags[i] ? ' ' : '│')
  }
  columns.push(isLast ? '└─' : '├─')

  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 font-mono text-slate-600/60 whitespace-pre select-none"
    >
      {columns.join(' ')}
    </span>
  )
}

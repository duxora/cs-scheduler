import { useState } from 'react'
import useSWR from 'swr'

// ── types ──────────────────────────────────────────────────────────────────

interface MisplacedTask {
  id: number
  title: string
  current_project: string
  suggested_project: string
}

// ── fetcher ────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── hook ───────────────────────────────────────────────────────────────────

export function useMisplacedCount(projectFilter: string): number {
  const params = new URLSearchParams()
  if (projectFilter) params.set('project', projectFilter)
  const { data } = useSWR<MisplacedTask[]>(
    `/workflow/api/misplaced-tasks?${params}`,
    fetcher,
    { refreshInterval: 30000 },
  )
  return data?.length ?? 0
}

// ── main component ─────────────────────────────────────────────────────────

interface MisplacedBannerProps {
  projectFilter: string
}

export default function MisplacedBanner({ projectFilter }: MisplacedBannerProps) {
  const [expanded, setExpanded] = useState(false)

  const params = new URLSearchParams()
  if (projectFilter) params.set('project', projectFilter)

  const { data: misplaced } = useSWR<MisplacedTask[]>(
    `/workflow/api/misplaced-tasks?${params}`,
    fetcher,
    { refreshInterval: 30000 },
  )

  if (!misplaced || misplaced.length === 0) return null

  return (
    <div className="mx-2 mb-1 rounded-lg bg-amber-950/30 border border-amber-800">
      {/* Banner row */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="text-amber-400 shrink-0" aria-hidden="true">⚠</span>
        <span className="text-xs text-amber-300 flex-1">
          {misplaced.length} task{misplaced.length !== 1 ? 's' : ''} may be in the wrong project
        </span>
        <span className="text-[11px] text-amber-400 shrink-0">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="border-t border-amber-800/50 px-3 pb-2 pt-1.5 flex flex-col gap-1">
          {misplaced.map((task) => (
            <div key={task.id} className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 shrink-0">#{task.id}</span>
              <span className="text-gray-200 truncate flex-1 min-w-0">{task.title}</span>
              <span className="text-amber-400 shrink-0 whitespace-nowrap">
                {task.current_project}
                <span className="text-amber-600 mx-1">→</span>
                {task.suggested_project}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

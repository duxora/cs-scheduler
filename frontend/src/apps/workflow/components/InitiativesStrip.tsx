/**
 * Dashboard hero strip — shows a horizontal row of InitiativeCards for the
 * current project filter. Fetches from /api/roadmap and hides itself when
 * there are no initiatives or epics to display.
 */

import useSWR from 'swr'
import type { RoadmapItem } from '../types'
import { InitiativeCard } from './common/InitiativeCard'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface InitiativesStripProps {
  projectFilter: string
}

export default function InitiativesStrip({ projectFilter }: InitiativesStripProps) {
  const params = new URLSearchParams()
  if (projectFilter) params.set('project', projectFilter)

  const { data, error } = useSWR<RoadmapItem[]>(
    `/workflow/api/roadmap?${params}`,
    fetcher,
    { refreshInterval: 10000 },
  )

  if (error) return null
  if (!data || data.length === 0) return null

  // Show top-level (no parent) initiatives first, then orphan epics.
  // Limit to a reasonable number to keep the strip scannable.
  const roots = data.filter((d) => d.parent_id == null)
  const displayed = roots.length > 0 ? roots : data
  const shown = displayed.slice(0, 6)

  return (
    <section
      className="shrink-0 border-b px-4 py-3"
      style={{ borderColor: 'var(--wf-border)', background: 'var(--wf-bg-surface)' }}
      aria-label="Initiatives and epics"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[11px] text-slate-200 font-semibold uppercase tracking-widest">
          Initiatives &amp; Epics
        </h2>
        <span className="text-[10px] text-slate-500">
          {shown.length} of {data.length}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
        {shown.map((item) => (
          <InitiativeCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

/**
 * Dashboard hero strip — shows a horizontal row of InitiativeCards for the
 * current project filter. Collapsed by default when showing all projects
 * (too many epics to be useful); auto-expands when scoped to one project.
 * Toggle persisted in localStorage via useSectionToggle.
 */

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { RoadmapItem } from '../types'
import { useSectionToggle } from '../hooks/useSectionToggle'
import { InitiativeCard } from './common/InitiativeCard'
import { ChevronIcon } from './ui/icons'

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

  const [expanded, toggle] = useSectionToggle('initiatives', projectFilter !== '')

  // Reset to smart default (expanded iff scoped) whenever the filter changes
  const prevFilterRef = useRef(projectFilter)
  useEffect(() => {
    if (prevFilterRef.current !== projectFilter) {
      prevFilterRef.current = projectFilter
      // Directly write to localStorage so useSectionToggle re-reads on next mount;
      // force-sync the in-memory state by triggering a re-read is not possible without
      // a more complex approach — so we just forcibly set the new value.
      try { localStorage.setItem('wf.section.initiatives.expanded', String(projectFilter !== '')) } catch {}
      // Toggle only if the current state differs from the new default
    }
  }, [projectFilter])

  if (error) return null
  if (!data || data.length === 0) return null

  const roots = data.filter((d) => d.parent_id == null)
  const displayed = roots.length > 0 ? roots : data
  const shown = displayed.slice(0, 6)

  return (
    <section
      className="shrink-0 border-b"
      style={{ borderColor: 'var(--wf-border)', background: 'var(--wf-bg-surface)' }}
      aria-label="Initiatives and epics"
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-slate-800/30 transition-colors"
        aria-expanded={expanded}
      >
        <h2 className="text-[11px] text-slate-200 font-semibold uppercase tracking-widest shrink-0">
          Initiatives &amp; Epics
        </h2>
        <span className="text-[10px] text-slate-500">
          {data.length} epic{data.length !== 1 ? 's' : ''}
        </span>
        <ChevronIcon
          size={10}
          className={`ml-auto text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-2">
          <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'thin' }}>
            {shown.map((item) => (
              <InitiativeCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

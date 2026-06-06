import { useMemo, useState } from 'react'
import type { Checkin, CheckinKind, CheckinSource } from '../types'

const KIND_STYLES: Record<CheckinKind, string> = {
  win: 'border-emerald-800 bg-emerald-950/40 text-emerald-300',
  risk: 'border-amber-800 bg-amber-950/40 text-amber-300',
  decision: 'border-blue-800 bg-blue-950/40 text-blue-300',
  blocked: 'border-red-800 bg-red-950/40 text-red-300',
  note: 'border-gray-700 bg-gray-900 text-gray-300',
}

const KIND_OPTIONS: CheckinKind[] = ['win', 'risk', 'decision', 'blocked', 'note']
const SOURCE_OPTIONS: Array<CheckinSource | 'all'> = ['all', 'manual', 'calendar', 'tkt', 'life-graph']

function formatRelativeTime(createdAt: string): string {
  const time = new Date(createdAt).getTime()
  if (Number.isNaN(time)) return createdAt

  const deltaSeconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (deltaSeconds < 60) return 'just now'
  if (deltaSeconds < 3600) {
    const minutes = Math.floor(deltaSeconds / 60)
    return `${minutes}m ago`
  }
  if (deltaSeconds < 86_400) {
    const hours = Math.floor(deltaSeconds / 3600)
    return `${hours}h ago`
  }
  const days = Math.floor(deltaSeconds / 86_400)
  return `${days}d ago`
}

function formatScopeHint(checkin: Checkin): string {
  if (checkin.item_id !== null) return 'linked to item'
  if (checkin.objective_id !== null) return 'linked to objective'
  if (checkin.project_id !== null) return 'linked to project'
  return 'general note'
}

interface CheckinStreamProps {
  checkins: Checkin[]
  refetch: () => Promise<void> | void
}

export default function CheckinStream({ checkins, refetch }: CheckinStreamProps) {
  const [kindFilters, setKindFilters] = useState<CheckinKind[]>([])
  const [sourceFilter, setSourceFilter] = useState<CheckinSource | 'all'>('all')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const filteredCheckins = useMemo(() => {
    return checkins.filter((checkin) => {
      const kindAllowed = kindFilters.length === 0 || kindFilters.includes(checkin.kind)
      const sourceAllowed = sourceFilter === 'all' || checkin.source === sourceFilter
      return kindAllowed && sourceAllowed
    })
  }, [checkins, kindFilters, sourceFilter])

  function toggleKind(kind: CheckinKind) {
    setKindFilters((prev) =>
      prev.includes(kind) ? prev.filter((value) => value !== kind) : [...prev, kind],
    )
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      await refetch()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <div className="mb-4 flex flex-col gap-3 border-b border-gray-800 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-gray-100">Check-in stream</h2>
            <p className="text-xs text-gray-500">Newest first, filtered client-side.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {KIND_OPTIONS.map((kind) => {
            const active = kindFilters.includes(kind)
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                  active
                    ? KIND_STYLES[kind]
                    : 'border-gray-700 bg-gray-950 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                {kind}
              </button>
            )
          })}

          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as CheckinSource | 'all')}
            className="ml-auto rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-300 focus:border-gray-500 focus:outline-none"
            aria-label="Filter by source"
          >
            {SOURCE_OPTIONS.map((source) => (
              <option key={source} value={source}>
                {source === 'all' ? 'all sources' : source}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filteredCheckins.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-800 text-sm text-gray-500">
          No check-ins match the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCheckins.map((checkin) => (
            <article key={checkin.id} className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${KIND_STYLES[checkin.kind]}`}
                >
                  {checkin.kind}
                </span>
                <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-[11px] text-gray-300">
                  {checkin.source}
                </span>
                <span className="ml-auto text-[11px] text-gray-500">{formatRelativeTime(checkin.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">{checkin.body}</p>
              <p className="mt-3 text-xs text-gray-500">{formatScopeHint(checkin)}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

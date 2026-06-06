import { useEffect, useMemo, useState } from 'react'
import { splannerApi } from '../lib/api'
import type {
  Checkin,
  CheckinKind,
  CheckinSource,
  ProjectDetail,
  UpdateCheckinPayload,
} from '../types'

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

type SuggestionLevel = NonNullable<Checkin['suggested_level']>

interface SuggestionDraft {
  level: SuggestionLevel
  id: number | ''
}

function buildSuggestionPayload(level: SuggestionLevel, id: number): UpdateCheckinPayload {
  if (level === 'project') return { project_id: id }
  if (level === 'objective') return { objective_id: id }
  return { item_id: id }
}

function findSuggestedName(
  detailByProjectId: Record<number, ProjectDetail>,
  checkin: Checkin,
): string | null {
  if (checkin.suggested_level === null || checkin.suggested_id === null || checkin.project_id === null) return null

  const detail = detailByProjectId[checkin.project_id]
  if (!detail) return null

  if (checkin.suggested_level === 'project') {
    return detail.project.id === checkin.suggested_id ? detail.project.name : null
  }

  for (const objective of detail.objectives) {
    if (checkin.suggested_level === 'objective' && objective.id === checkin.suggested_id) {
      return objective.name
    }
    if (checkin.suggested_level === 'item') {
      const item = objective.items.find((entry) => entry.id === checkin.suggested_id)
      if (item) return item.name
    }
  }

  return null
}

export default function CheckinStream({ checkins, refetch }: CheckinStreamProps) {
  const [kindFilters, setKindFilters] = useState<CheckinKind[]>([])
  const [sourceFilter, setSourceFilter] = useState<CheckinSource | 'all'>('all')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [detailByProjectId, setDetailByProjectId] = useState<Record<number, ProjectDetail>>({})
  const [editingCheckinId, setEditingCheckinId] = useState<number | null>(null)
  const [draftByCheckinId, setDraftByCheckinId] = useState<Record<number, SuggestionDraft>>({})
  const [pendingCheckinId, setPendingCheckinId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const filteredCheckins = useMemo(() => {
    return checkins.filter((checkin) => {
      const kindAllowed = kindFilters.length === 0 || kindFilters.includes(checkin.kind)
      const sourceAllowed = sourceFilter === 'all' || checkin.source === sourceFilter
      return kindAllowed && sourceAllowed
    })
  }, [checkins, kindFilters, sourceFilter])

  const projectIds = useMemo(
    () =>
      Array.from(
        new Set(
          checkins
            .map((checkin) => checkin.project_id)
            .filter((projectId): projectId is number => projectId !== null),
        ),
      ),
    [checkins],
  )

  useEffect(() => {
    if (projectIds.length === 0) {
      setDetailByProjectId({})
      return
    }

    let cancelled = false

    void Promise.all(
      projectIds.map(async (projectId) => [projectId, await splannerApi.getProjectDetail(projectId)] as const),
    )
      .then((entries) => {
        if (cancelled) return
        setDetailByProjectId(Object.fromEntries(entries))
      })
      .catch(() => {
        if (cancelled) return
        setDetailByProjectId({})
      })

    return () => {
      cancelled = true
    }
  }, [projectIds])

  function toggleKind(kind: CheckinKind) {
    setKindFilters((prev) =>
      prev.includes(kind) ? prev.filter((value) => value !== kind) : [...prev, kind],
    )
  }

  function getProjectDetail(checkin: Checkin): ProjectDetail | null {
    if (checkin.project_id === null) return null
    return detailByProjectId[checkin.project_id] ?? null
  }

  function getDraft(checkin: Checkin): SuggestionDraft {
    const existing = draftByCheckinId[checkin.id]
    if (existing) return existing

    if (checkin.suggested_level !== null && checkin.suggested_id !== null) {
      return { level: checkin.suggested_level, id: checkin.suggested_id }
    }

    const detail = getProjectDetail(checkin)
    if (detail) {
      return { level: 'project', id: detail.project.id }
    }

    return { level: 'project', id: '' }
  }

  function buildOptions(checkin: Checkin, level: SuggestionLevel): Array<{ id: number; name: string }> {
    const detail = getProjectDetail(checkin)
    if (!detail) return []

    if (level === 'project') {
      return [{ id: detail.project.id, name: detail.project.name }]
    }

    if (level === 'objective') {
      return detail.objectives.map((objective) => ({ id: objective.id, name: objective.name }))
    }

    return detail.objectives.flatMap((objective) =>
      objective.items.map((item) => ({
        id: item.id,
        name: `${objective.name} / ${item.name}`,
      })),
    )
  }

  function setDraft(checkinId: number, nextDraft: SuggestionDraft) {
    setDraftByCheckinId((prev) => ({ ...prev, [checkinId]: nextDraft }))
  }

  async function submitUpdate(checkinId: number, payload: UpdateCheckinPayload) {
    setPendingCheckinId(checkinId)
    setActionError(null)
    try {
      await splannerApi.updateCheckin(checkinId, payload)
      setEditingCheckinId((current) => (current === checkinId ? null : current))
      setDraftByCheckinId((prev) => {
        if (!(checkinId in prev)) return prev
        const next = { ...prev }
        delete next[checkinId]
        return next
      })
      await refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update check-in.')
    } finally {
      setPendingCheckinId((current) => (current === checkinId ? null : current))
    }
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

        {actionError && (
          <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-300" role="alert">
            {actionError}
          </div>
        )}

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
              {checkin.suggested_level !== null && checkin.suggested_id !== null && (
                <div className="mt-3 rounded-xl border border-blue-800/60 bg-blue-950/20 p-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-blue-800/80 bg-blue-950/40 px-2.5 py-1 text-[11px] font-medium text-blue-200">
                        AI suggests linking to {checkin.suggested_level}:{' '}
                        {findSuggestedName(detailByProjectId, checkin) ?? `#${checkin.suggested_id}`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void submitUpdate(
                            checkin.id,
                            buildSuggestionPayload(checkin.suggested_level as SuggestionLevel, checkin.suggested_id as number),
                          )
                        }
                        disabled={pendingCheckinId === checkin.id}
                        className="rounded-lg border border-blue-700 bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingCheckinId === checkin.id ? 'Saving…' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nextOpen = editingCheckinId === checkin.id ? null : checkin.id
                          setEditingCheckinId(nextOpen)
                          if (nextOpen === checkin.id) {
                            setDraft(checkin.id, getDraft(checkin))
                          }
                        }}
                        disabled={pendingCheckinId === checkin.id}
                        className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Change
                      </button>
                    </div>

                    {editingCheckinId === checkin.id && (() => {
                      const draft = getDraft(checkin)
                      const options = buildOptions(checkin, draft.level)

                      return (
                        <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_auto]">
                          <select
                            value={draft.level}
                            onChange={(event) => {
                              const level = event.target.value as SuggestionLevel
                              const nextOptions = buildOptions(checkin, level)
                              setDraft(checkin.id, { level, id: nextOptions[0]?.id ?? '' })
                            }}
                            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
                          >
                            <option value="project">project</option>
                            <option value="objective">objective</option>
                            <option value="item">item</option>
                          </select>
                          <select
                            value={draft.id === '' ? '' : String(draft.id)}
                            onChange={(event) =>
                              setDraft(checkin.id, {
                                level: draft.level,
                                id: event.target.value === '' ? '' : Number.parseInt(event.target.value, 10),
                              })
                            }
                            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
                          >
                            {options.length === 0 ? (
                              <option value="">No targets available</option>
                            ) : (
                              options.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))
                            )}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              if (draft.id === '') return
                              void submitUpdate(checkin.id, buildSuggestionPayload(draft.level, draft.id))
                            }}
                            disabled={pendingCheckinId === checkin.id || draft.id === ''}
                            className="rounded-lg border border-gray-700 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Save
                          </button>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

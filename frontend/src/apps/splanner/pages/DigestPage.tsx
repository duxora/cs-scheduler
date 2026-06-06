import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DigestPanels from '../components/DigestPanels'
import { splannerApi } from '../lib/api'
import type { Digest, DigestNudge, DigestState, FocusItem } from '../types'

const LIFECYCLE_LABELS: Record<DigestState, string> = {
  drafted: 'AI-drafted',
  needs_review: 'needs review',
  approved: 'approved',
}

const LIFECYCLE_STYLES: Record<DigestState, string> = {
  drafted: 'border-blue-800 bg-blue-950/40 text-blue-300',
  needs_review: 'border-amber-800 bg-amber-950/40 text-amber-300',
  approved: 'border-emerald-800 bg-emerald-950/40 text-emerald-300',
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`)
  if (Number.isNaN(start.getTime())) return weekStart
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function getMondayIso(value: Date = new Date()): string {
  const day = new Date(value)
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  const year = day.getFullYear()
  const month = String(day.getMonth() + 1).padStart(2, '0')
  const date = String(day.getDate()).padStart(2, '0')
  return `${year}-${month}-${date}`
}

export default function DigestPage() {
  const navigate = useNavigate()
  const [digests, setDigests] = useState<Digest[]>([])
  const [selectedDigestId, setSelectedDigestId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDrafting, setIsDrafting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isSavingNarrative, setIsSavingNarrative] = useState(false)
  const [isSavingFocus, setIsSavingFocus] = useState(false)
  const [isEditingNarrative, setIsEditingNarrative] = useState(false)
  const [narrativeDraft, setNarrativeDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectedIndex = useMemo(
    () => digests.findIndex((digest) => digest.id === selectedDigestId),
    [digests, selectedDigestId],
  )
  const currentDigest = useMemo<Digest | null>(() => {
    if (selectedIndex < 0) return null
    return digests[selectedIndex] ?? null
  }, [digests, selectedIndex])

  async function loadDigests(preferredDigestId?: number) {
    setIsLoading(true)
    setError(null)
    try {
      const nextDigests = await splannerApi.listDigests()
      setDigests(nextDigests)
      if (nextDigests.length === 0) {
        setSelectedDigestId(null)
        setNarrativeDraft('')
        setIsEditingNarrative(false)
        return
      }
      const firstDigest = nextDigests[0]
      if (!firstDigest) {
        setSelectedDigestId(null)
        setNarrativeDraft('')
        setIsEditingNarrative(false)
        return
      }

      const nextSelectedId =
        preferredDigestId && nextDigests.some((digest) => digest.id === preferredDigestId)
          ? preferredDigestId
          : selectedDigestId !== null && nextDigests.some((digest) => digest.id === selectedDigestId)
            ? selectedDigestId
            : firstDigest.id
      const nextSelected = nextDigests.find((digest) => digest.id === nextSelectedId) ?? firstDigest
      setSelectedDigestId(nextSelected.id)
      setNarrativeDraft(nextSelected.narrative_md)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load digests.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadDigests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (currentDigest && !isEditingNarrative) {
      setNarrativeDraft(currentDigest.narrative_md)
    }
  }, [currentDigest, isEditingNarrative])

  async function handleDraft() {
    const weekStart = currentDigest?.week_start ?? getMondayIso()
    setIsDrafting(true)
    setError(null)
    try {
      const digest = await splannerApi.draftDigest(weekStart)
      setIsEditingNarrative(false)
      await loadDigests(digest.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft digest.')
    } finally {
      setIsDrafting(false)
    }
  }

  async function handleApprove() {
    if (!currentDigest) return
    setIsApproving(true)
    setError(null)
    try {
      const digest = await splannerApi.approveDigest(currentDigest.id)
      await loadDigests(digest.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve digest.')
    } finally {
      setIsApproving(false)
    }
  }

  async function handleSaveNarrative() {
    if (!currentDigest) return
    setIsSavingNarrative(true)
    setError(null)
    try {
      const digest = await splannerApi.updateDigest(currentDigest.id, { narrative_md: narrativeDraft })
      setIsEditingNarrative(false)
      await loadDigests(digest.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save narrative.')
    } finally {
      setIsSavingNarrative(false)
    }
  }

  async function handleFocusToggle(index: number, checked: boolean) {
    if (!currentDigest) return
    const nextFocus: FocusItem[] = currentDigest.focus.map((item, itemIndex) =>
      itemIndex === index ? { ...item, accepted: checked } : item,
    )
    setIsSavingFocus(true)
    setError(null)
    try {
      const digest = await splannerApi.updateDigest(currentDigest.id, { focus: nextFocus })
      await loadDigests(digest.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update focus.')
    } finally {
      setIsSavingFocus(false)
    }
  }

  function handleNudgeClick(nudge: DigestNudge) {
    if (nudge.project_id === null) return
    navigate(`/splanner/projects/${nudge.project_id}`)
  }

  const canGoPrev = selectedIndex >= 0 && selectedIndex < digests.length - 1
  const canGoNext = selectedIndex > 0
  const previousDigest = canGoPrev ? (digests[selectedIndex + 1] ?? null) : null
  const nextDigest = canGoNext ? (digests[selectedIndex - 1] ?? null) : null

  return (
    <div className="flex min-h-full flex-col bg-gray-950 px-4 py-4 text-gray-100 overflow-y-auto">
      <div className="mb-6 flex flex-col gap-4 border-b border-gray-800 pb-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Weekly digest</h1>
            <p className="text-sm text-gray-500">Draft, review, and approve the weekly SPlanner summary.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/splanner" className="text-sm text-gray-500 transition-colors hover:text-gray-300">
              Back to dashboard
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-300" role="alert">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!previousDigest) return
                    setSelectedDigestId(previousDigest.id)
                    setIsEditingNarrative(false)
                  }}
                  disabled={!canGoPrev || isLoading}
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!nextDigest) return
                    setSelectedDigestId(nextDigest.id)
                    setIsEditingNarrative(false)
                  }}
                  disabled={!canGoNext || isLoading}
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  ▶
                </button>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-100">
                  {currentDigest ? formatWeekRange(currentDigest.week_start) : formatWeekRange(getMondayIso())}
                </p>
                <p className="text-xs text-gray-500">
                  {currentDigest ? currentDigest.week_start : `${getMondayIso()} · current week`}
                </p>
              </div>
              {currentDigest ? (
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${LIFECYCLE_STYLES[currentDigest.state]}`}>
                  {LIFECYCLE_LABELS[currentDigest.state]}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleDraft()}
                disabled={isDrafting}
                className="rounded-lg border border-gray-700 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDrafting ? 'Drafting…' : currentDigest ? 'Re-draft' : 'Draft digest'}
              </button>
              {currentDigest && currentDigest.state !== 'approved' ? (
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={isApproving || isDrafting}
                  className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isApproving ? 'Approving…' : 'Approve & save'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-800 text-sm text-gray-500">
            Loading digest…
          </div>
        ) : currentDigest === null ? (
          <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
            <h2 className="text-lg font-medium text-gray-100">No digest drafted yet</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-500">
              Draft the weekly digest to summarize check-ins, review KPI deltas, and capture risks, nudges, and focus items for the week.
            </p>
            <button
              type="button"
              onClick={() => void handleDraft()}
              disabled={isDrafting}
              className="mt-6 rounded-lg border border-gray-700 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDrafting ? 'Drafting…' : 'Draft digest'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-gray-100">Narrative</h2>
                  <p className="text-xs text-gray-500">Inline-editable weekly rollup for the current draft.</p>
                </div>
                {currentDigest.state !== 'approved' ? (
                  <div className="flex items-center gap-2">
                    {isEditingNarrative ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setNarrativeDraft(currentDigest.narrative_md)
                            setIsEditingNarrative(false)
                          }}
                          className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveNarrative()}
                          disabled={isSavingNarrative}
                          className="rounded-lg border border-gray-700 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingNarrative ? 'Saving…' : 'Save'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsEditingNarrative(true)}
                        className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              {isEditingNarrative ? (
                <textarea
                  value={narrativeDraft}
                  onChange={(event) => setNarrativeDraft(event.target.value)}
                  rows={12}
                  className="min-h-[280px] w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm leading-6 text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
              ) : (
                <div className="rounded-xl border border-gray-800 bg-gray-950/70 px-4 py-4">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">
                    {currentDigest.narrative_md || 'No narrative drafted yet.'}
                  </p>
                </div>
              )}
            </section>

            <DigestPanels
              digest={currentDigest}
              isReadOnly={currentDigest.state === 'approved'}
              isSavingFocus={isSavingFocus}
              onFocusToggle={handleFocusToggle}
              onNudgeClick={handleNudgeClick}
            />
          </div>
        )}
      </div>
    </div>
  )
}

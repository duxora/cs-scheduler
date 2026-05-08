import { useCallback, useMemo, useState } from 'react'
import FilterBar from '../components/common/FilterBar'
import ReviewFeed from '../components/ReviewFeed'
import ReviewDetailPanel from '../components/ReviewDetailPanel'
import SummaryStrip from '../components/SummaryStrip'
import { useReview, getStalledStep } from '../hooks/useReview'
import { useUrlParam } from '../hooks/useUrlParam'
import type { PipelineState, PipelineType } from '../types'

const PERIODS: Record<'today' | '7d' | '30d', number> = {
  today: 24,
  '7d': 168,
  '30d': 720,
}

const PIPELINE_TYPES: { value: PipelineType | ''; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'code', label: 'Code' },
  { value: 'research', label: 'Research' },
  { value: 'docs', label: 'Docs' },
  { value: 'solo-commit', label: 'Solo commit' },
]

export default function PipelinesPage() {
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('today')
  const [domainFilter, setDomainFilter] = useUrlParam('project')
  const [typeFilterRaw, setTypeFilter] = useUrlParam('type')
  const [detailKey, setDetailKey] = useUrlParam('detail')
  const typeFilter = typeFilterRaw as PipelineType | ''

  const { stalled, completed, summary, isLoading, error } = useReview(PERIODS[period])
  const hasError = error != null

  const reviewPipelines = useMemo(() => [...stalled, ...completed], [stalled, completed])

  const selectedTaskId = useMemo(() => {
    if (!detailKey) return null
    const [kind, idStr] = detailKey.split(':')
    if (kind !== 'pipeline') return null
    const taskId = Number(idStr)
    return Number.isFinite(taskId) ? taskId : null
  }, [detailKey])

  const selectedPipeline = useMemo(
    () => (selectedTaskId == null ? null : reviewPipelines.find((pipeline) => pipeline.task_id === selectedTaskId) ?? null),
    [reviewPipelines, selectedTaskId],
  )

  const setSelected = useCallback(
    (pipeline: PipelineState | null) => {
      setDetailKey(pipeline ? `pipeline:${pipeline.task_id}` : '')
    },
    [setDetailKey],
  )

  const matchesFilters = useCallback(
    (pipeline: PipelineState) => {
      if (domainFilter && pipeline.domain !== domainFilter) return false
      if (typeFilter && pipeline.pipeline !== typeFilter) return false
      return true
    },
    [domainFilter, typeFilter],
  )

  const filteredPipelines = useMemo(
    () => reviewPipelines.filter(matchesFilters),
    [matchesFilters, reviewPipelines],
  )

  const filteredStalled = useMemo(
    () => stalled.filter(matchesFilters),
    [matchesFilters, stalled],
  )
  const filteredCompleted = useMemo(
    () => completed.filter(matchesFilters),
    [completed, matchesFilters],
  )

  const stalledSteps = useMemo<Record<number, string>>(() => {
    const map: Record<number, string> = {}
    for (const pipeline of stalled) {
      map[pipeline.task_id] = getStalledStep(pipeline)
    }
    return map
  }, [stalled])

  const domains = useMemo(() => {
    const seen = new Set<string>()
    for (const pipeline of reviewPipelines) {
      if (pipeline.domain) seen.add(pipeline.domain)
    }
    return Array.from(seen).sort()
  }, [reviewPipelines])

  return (
    <div className="flex h-full flex-col bg-gray-950 text-gray-100">
      <FilterBar className="border-gray-800 py-2">
        <div className="flex items-center gap-1 rounded-md border border-gray-800 bg-gray-900/60 p-1">
          {(['today', '7d', '30d'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              className={[
                'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                period === value ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-100',
              ].join(' ')}
            >
              {value}
            </button>
          ))}
        </div>

        <FilterBar.Select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          aria-label="Filter by domain"
        >
          <option value="">All domains</option>
          {domains.map((domain) => (
            <option key={domain} value={domain}>
              {domain}
            </option>
          ))}
        </FilterBar.Select>

        <FilterBar.Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by type"
        >
          {PIPELINE_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FilterBar.Select>

        <FilterBar.Count>
          {isLoading ? 'Loading...' : `${filteredPipelines.length} run${filteredPipelines.length === 1 ? '' : 's'}`}
        </FilterBar.Count>

        {hasError && (
          <span className="rounded border border-red-800 bg-red-950 px-1.5 py-0.5 text-[10px] text-red-300">
            API error
          </span>
        )}
      </FilterBar>

      <SummaryStrip summary={summary} />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="flex h-24 items-center justify-center">
              <span className="text-xs text-gray-600">Loading review feed...</span>
            </div>
          ) : (
            <ReviewFeed
              stalled={filteredStalled}
              completed={filteredCompleted}
              stalledSteps={stalledSteps}
              selectedId={selectedTaskId}
              onSelect={setSelected}
            />
          )}
        </div>

        {selectedPipeline && (
          <ReviewDetailPanel
            pipeline={selectedPipeline}
            isStalled={stalledSteps[selectedPipeline.task_id] != null}
            stalledStep={stalledSteps[selectedPipeline.task_id] ?? 'start'}
            onClose={() => setSelected(null)}
            onDismiss={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

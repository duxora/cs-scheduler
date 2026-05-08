import useSWR from 'swr'
import { fetchJson } from '../lib/api'
import type { PipelineRunsResponse, PipelineState, PipelineStateResponse, ReviewSummary } from '../types'

const STALL_THRESHOLD_MS = 5 * 60 * 1000

export function isStalled(pipeline: PipelineState): boolean {
  if (pipeline.completed_at) return false
  if (!pipeline.heartbeat_at) return true
  return Date.now() - new Date(pipeline.heartbeat_at).getTime() > STALL_THRESHOLD_MS
}

export function getStalledStep(pipeline: PipelineState): string {
  const entries = Object.entries(pipeline.steps)
  let firstPending = entries.findIndex(([, step]) => step.status === 'pending')
  if (firstPending < 0) firstPending = entries.length

  for (let i = firstPending - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (!entry) continue
    const [stepName, stepState] = entry
    if (stepState.status !== 'pending') return stepName
  }

  return 'start'
}

function durationSeconds(pipeline: PipelineState): number {
  if (!pipeline.completed_at) return 0
  const ms = new Date(pipeline.completed_at).getTime() - new Date(pipeline.started_at).getTime()
  return Math.max(0, Math.round(ms / 1000))
}

function summarize(runs: PipelineState[]): ReviewSummary {
  let completed = 0
  let stalled = 0
  let tokens_today = 0
  let durationTotal = 0

  for (const run of runs) {
    if (isStalled(run)) stalled += 1
    else if (run.completed_at) {
      completed += 1
      durationTotal += durationSeconds(run)
    }

    if ((run.tokens_consumed ?? 0) > 0) {
      tokens_today += run.tokens_consumed ?? 0
    }
  }

  return {
    completed,
    stalled,
    tokens_today,
    avg_duration_s: completed > 0 ? Math.round(durationTotal / completed) : 0,
  }
}

export function useReview(hours: number): {
  stalled: PipelineState[]
  completed: PipelineState[]
  summary: ReviewSummary
  isLoading: boolean
  error: unknown
} {
  const { data: stateData, error: stateError, isLoading: stateLoading } = useSWR<PipelineStateResponse>(
    '/pipeline-state',
    fetchJson<PipelineStateResponse>,
    { refreshInterval: 3000 },
  )
  const { data: historyData, error: historyError, isLoading: historyLoading } = useSWR<PipelineRunsResponse>(
    `/pipeline-runs/recent?hours=${hours}`,
    fetchJson<PipelineRunsResponse>,
    { refreshInterval: 30000 },
  )

  const active = stateData?.pipelines ?? []
  const recent = historyData?.runs ?? []
  const activeIds = new Set(active.map((pipeline) => pipeline.session_id))
  const merged = [...active, ...recent.filter((pipeline) => !activeIds.has(pipeline.session_id))]

  const stalled = merged
    .filter((pipeline) => isStalled(pipeline))
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())

  const completed = merged
    .filter((pipeline) => !isStalled(pipeline) && Boolean(pipeline.completed_at))
    .sort((a, b) => new Date(b.completed_at ?? b.started_at).getTime() - new Date(a.completed_at ?? a.started_at).getTime())

  return {
    stalled,
    completed,
    summary: summarize(merged),
    isLoading: stateLoading || historyLoading,
    error: stateError ?? historyError,
  }
}

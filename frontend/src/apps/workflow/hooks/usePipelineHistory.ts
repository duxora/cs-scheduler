import useSWR from 'swr'
import { fetchJson } from '../lib/api'
import type { PipelineRunsResponse, PipelineState } from '../types'

export function usePipelineHistory(hours = 24): { runs: PipelineState[]; error: unknown } {
  const { data, error } = useSWR<PipelineRunsResponse>(
    `/pipeline-runs/recent?hours=${hours}`,
    fetchJson<PipelineRunsResponse>,
    { refreshInterval: 30000 },
  )
  return {
    runs: data?.runs ?? [],
    error,
  }
}

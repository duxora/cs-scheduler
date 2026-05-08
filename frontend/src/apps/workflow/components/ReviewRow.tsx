import type { PipelineState } from '../types'
import { formatDuration, formatElapsed, formatTimeAgo } from '../lib/time'

const STEP_LABELS: Record<string, string> = {
  kb_lookup: 'KB',
  branch: 'Branch',
  implement: 'Impl',
  build: 'Build',
  e2e_local: 'E2E',
  pr: 'PR',
  ci: 'CI',
  e2e_deploy: 'Deploy',
  compact: 'Compact',
  handoff: 'Handoff',
  review: 'Review',
}

function getStepLabel(step: string): string {
  return STEP_LABELS[step] ?? step
}

function getStepClass(status: string): string {
  if (status === 'done') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  if (status === 'failed') return 'bg-red-500/15 text-red-300 border-red-500/30'
  return 'bg-gray-800 text-gray-400 border-gray-700'
}

function formatCompletedDuration(pipeline: PipelineState): string {
  if (!pipeline.completed_at) return '—'
  const ms = new Date(pipeline.completed_at).getTime() - new Date(pipeline.started_at).getTime()
  return formatDuration(Math.max(0, Math.round(ms / 1000)))
}

export interface ReviewRowProps {
  pipeline: PipelineState
  isStalled: boolean
  stalledStep: string
  selected: boolean
  onSelect: () => void
}

export default function ReviewRow({
  pipeline,
  isStalled,
  stalledStep,
  selected,
  onSelect,
}: ReviewRowProps) {
  const tokens = Math.max(0, pipeline.tokens_consumed ?? 0)
  const typeLabel = `${pipeline.pipeline} · ${pipeline.size}`

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full text-left rounded-lg border-l-2 border px-3 py-2.5 transition-colors',
        isStalled ? 'border-l-amber-500' : 'border-l-emerald-500',
        selected ? 'border-blue-500 bg-blue-950/20' : 'border-gray-800 bg-gray-900/30 hover:bg-gray-900/60',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <span
          className={[
            'mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full',
            isStalled ? 'bg-amber-500' : 'bg-emerald-500',
          ].join(' ')}
          title={pipeline.heartbeat_at ? `Heartbeat ${formatTimeAgo(pipeline.heartbeat_at)}` : 'No heartbeat'}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-gray-500">#{pipeline.task_id}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-100">
              {pipeline.title}
            </span>
            <span className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">
              {typeLabel}
            </span>
            {pipeline.domain && (
              <span className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">
                {pipeline.domain}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(pipeline.steps).map(([step, state]) => (
              <span
                key={step}
                className={[
                  'rounded px-1.5 py-0.5 text-[10px] border tabular-nums',
                  getStepClass(state.status),
                ].join(' ')}
              >
                {getStepLabel(step)}
              </span>
            ))}
          </div>

          <div className="mt-1 text-[11px] text-gray-500">
            {isStalled ? (
              <span>
                Started {formatElapsed(pipeline.started_at)} ago · Stalled at {getStepLabel(stalledStep)}
              </span>
            ) : (
              <span>
                {formatCompletedDuration(pipeline)}
                {tokens > 0 ? ` · ${Math.round(tokens / 1000)}k tokens` : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

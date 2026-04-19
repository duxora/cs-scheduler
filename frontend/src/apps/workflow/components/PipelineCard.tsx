import type { DetailTarget } from '../types'
import type { ClassifiedPipeline } from '../lib/pipeline'
import { getStepLabel, getStepOrder, getStepColor } from '../lib/pipeline'
import { formatElapsed } from '../lib/time'

interface PipelineCardProps {
  classified: ClassifiedPipeline
  onSelect: (target: DetailTarget) => void
}

export default function PipelineCard({ classified, onSelect }: PipelineCardProps) {
  const { pipeline, lane, reason, progress, activeStep } = classified
  const pipelineLabel = pipeline.pipeline === 'code'
    ? `code/${pipeline.size}`
    : pipeline.pipeline

  const borderClass = lane === 'needs_you'
    ? reason?.includes('failed')
      ? 'border-l-2 border-l-red-500'
      : 'border-l-2 border-l-amber-500'
    : ''

  const steps = getStepOrder(pipeline.pipeline, pipeline.size)

  return (
    <div
      className={`bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors cursor-pointer ${borderClass}`}
      onClick={() => onSelect({ kind: 'pipeline', pipeline })}
    >
      {/* Header: task ID, title, project */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-gray-400 shrink-0">
            #{pipeline.task_id}
          </span>
          <span className="text-sm text-gray-200 truncate">
            {pipeline.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">
            {pipelineLabel}
          </span>
          {pipeline.domain && (
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">
              {pipeline.domain}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar + step info */}
      <div className="flex items-center gap-2 mb-1">
        <div className="flex items-center gap-0.5 flex-1">
          {steps.map((step) => {
            const state = pipeline.steps[step]
            if (!state || state.status === 'skipped') return null
            const isActive = step === activeStep
            const color = isActive && pipeline.stale
              ? 'bg-amber-500'
              : isActive
                ? 'bg-blue-500 animate-pulse'
                : getStepColor(state.status)
            return (
              <div
                key={step}
                className={`h-1.5 flex-1 rounded-full ${color}`}
                title={`${getStepLabel(step)}: ${state.status}`}
              />
            )
          })}
        </div>
        <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
          {progress.done}/{progress.total}
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {formatElapsed(pipeline.started_at)}
        </span>
      </div>

      {/* Status line */}
      <div className="flex items-center gap-1.5">
        {lane === 'needs_you' && reason && (
          <>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              reason.includes('failed') ? 'bg-red-500' : 'bg-amber-500'
            }`} />
            <span className={`text-xs ${
              reason.includes('failed') ? 'text-red-400' : 'text-amber-400'
            }`}>
              {reason}
            </span>
          </>
        )}
        {lane === 'running' && activeStep && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <span className="text-xs text-gray-400">
              {getStepLabel(activeStep)}
            </span>
          </>
        )}
        {lane === 'done' && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs text-gray-500">Complete</span>
          </>
        )}
      </div>
    </div>
  )
}

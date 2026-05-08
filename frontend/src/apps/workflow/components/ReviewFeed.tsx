import type { PipelineState } from '../types'
import { isStalled } from '../hooks/useReview'
import ReviewRow from './ReviewRow'

export interface ReviewFeedProps {
  stalled: PipelineState[]
  completed: PipelineState[]
  stalledSteps: Record<number, string>
  selectedId: number | null
  onSelect: (pipeline: PipelineState | null) => void
}

export default function ReviewFeed({
  stalled,
  completed,
  stalledSteps,
  selectedId,
  onSelect,
}: ReviewFeedProps) {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold">
            STALLED · NEEDS ATTENTION
          </h3>
          <span className="rounded-full border border-amber-500/30 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-200 tabular-nums">
            {stalled.length}
          </span>
        </div>

        <div className="space-y-2">
          {stalled.length === 0 ? (
            <p className="pl-4 text-xs text-gray-600">No stalled runs</p>
          ) : (
            stalled.map((pipeline) => (
              <ReviewRow
                key={pipeline.session_id}
                pipeline={pipeline}
                isStalled={isStalled(pipeline)}
                stalledStep={stalledSteps[pipeline.task_id] ?? 'start'}
                selected={selectedId === pipeline.task_id}
                onSelect={() => onSelect(selectedId === pipeline.task_id ? null : pipeline)}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gray-500" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">
            COMPLETED TODAY
          </h3>
          <span className="rounded-full border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400 tabular-nums">
            {completed.length}
          </span>
        </div>

        <div className="space-y-2">
          {completed.length === 0 ? (
            <p className="pl-4 text-xs text-gray-600">No completed runs</p>
          ) : (
            completed.map((pipeline) => (
              <ReviewRow
                key={pipeline.session_id}
                pipeline={pipeline}
                isStalled={false}
                stalledStep="start"
                selected={selectedId === pipeline.task_id}
                onSelect={() => onSelect(selectedId === pipeline.task_id ? null : pipeline)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

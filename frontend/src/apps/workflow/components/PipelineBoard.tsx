import { useMemo, useState } from 'react'
import type { PipelineState, DetailTarget } from '../types'
import { classifyAndGroup } from '../lib/pipeline'
import type { AttentionLane } from '../lib/pipeline'
import PipelineCard from './PipelineCard'

interface PipelineBoardProps {
  pipelines: PipelineState[]
  onSelect: (target: DetailTarget) => void
}

const LANE_CONFIG: Record<AttentionLane, { label: string; dotColor: string; emptyText: string }> = {
  needs_you: {
    label: 'Needs You',
    dotColor: 'bg-amber-500',
    emptyText: 'Nothing needs your attention',
  },
  running: {
    label: 'Running',
    dotColor: 'bg-blue-500 animate-pulse',
    emptyText: 'No active pipelines',
  },
  done: {
    label: 'Done Today',
    dotColor: 'bg-gray-500',
    emptyText: 'No completed pipelines',
  },
}

export default function PipelineBoard({ pipelines, onSelect }: PipelineBoardProps) {
  const groups = useMemo(() => classifyAndGroup(pipelines), [pipelines])
  const [doneExpanded, setDoneExpanded] = useState(false)

  if (pipelines.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 py-12">
        <p className="text-sm">No active pipelines</p>
        <p className="text-xs mt-1">
          Claim a task with <code className="bg-gray-800 px-1 rounded">tkt_next</code> or launch from backlog
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Lane: Needs You */}
      <Lane
        lane="needs_you"
        items={groups.needs_you}
        onSelect={onSelect}
      />

      {/* Lane: Running */}
      <Lane
        lane="running"
        items={groups.running}
        onSelect={onSelect}
      />

      {/* Lane: Done Today (collapsible) */}
      <section>
        <button
          onClick={() => setDoneExpanded(!doneExpanded)}
          className="flex items-center gap-2 mb-2 group"
        >
          <span className={`w-2 h-2 rounded-full ${LANE_CONFIG.done.dotColor}`} />
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            {LANE_CONFIG.done.label}
          </h3>
          <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-full tabular-nums">
            {groups.done.length}
          </span>
          <span className="text-[10px] text-gray-600 group-hover:text-gray-400 transition-colors">
            {doneExpanded ? '▾' : '▸'}
          </span>
        </button>
        {doneExpanded && (
          <div className="flex flex-col gap-2">
            {groups.done.length === 0 ? (
              <p className="text-xs text-gray-600 pl-4">{LANE_CONFIG.done.emptyText}</p>
            ) : (
              groups.done.map((c) => (
                <PipelineCard key={c.pipeline.session_id} classified={c} onSelect={onSelect} />
              ))
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Lane({
  lane,
  items,
  onSelect,
}: {
  lane: AttentionLane
  items: ReturnType<typeof classifyAndGroup>[AttentionLane]
  onSelect: (target: DetailTarget) => void
}) {
  const config = LANE_CONFIG[lane]

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
          {config.label}
        </h3>
        {items.length > 0 && (
          <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-full tabular-nums">
            {items.length}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-xs text-gray-600 pl-4">{config.emptyText}</p>
        ) : (
          items.map((c) => (
            <PipelineCard key={c.pipeline.session_id} classified={c} onSelect={onSelect} />
          ))
        )}
      </div>
    </section>
  )
}

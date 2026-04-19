import type { StepStatus, PipelineType, PipelineSize, PipelineState } from '../types'

const STEP_ORDER = {
  'code/small': ['kb_lookup', 'branch', 'implement', 'build', 'e2e_local', 'pr', 'ci', 'e2e_deploy', 'compact', 'handoff'] as const,
  'code/medium': ['kb_lookup', 'branch', 'implement', 'build', 'e2e_local', 'pr', 'ci', 'e2e_deploy', 'compact', 'handoff'] as const,
  'code/large': ['kb_lookup', 'brainstorm', 'write_plan', 'branch', 'implement', 'build', 'e2e_local', 'review', 'pr', 'ci', 'e2e_deploy', 'compact', 'handoff'] as const,
  research: ['kb_lookup', 'investigate', 'compact'] as const,
  docs: ['kb_lookup', 'write', 'compact'] as const,
  'solo-commit': ['kb_lookup', 'implement', 'build', 'compact'] as const,
} satisfies Record<string, readonly string[]>

const DEFAULT_ORDER = STEP_ORDER['code/medium']

export function getStepOrder(pipeline: PipelineType, size: PipelineSize): readonly string[] {
  const key = pipeline === 'code' ? `code/${size}` : pipeline
  if (key in STEP_ORDER) {
    return STEP_ORDER[key as keyof typeof STEP_ORDER]
  }
  return DEFAULT_ORDER
}

export function getActiveStep(pipeline: PipelineState): string | null {
  const order = getStepOrder(pipeline.pipeline, pipeline.size)
  for (const step of order) {
    const state = pipeline.steps[step]
    if (state?.status === 'failed') return step
    if (state?.status === 'pending') return step
  }
  return null
}

export function getStepColor(status: StepStatus | 'active' | 'stale'): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500'
    case 'active':
      return 'bg-blue-500'
    case 'pending':
      return 'bg-gray-600'
    case 'skipped':
      return 'bg-gray-700 opacity-40'
    case 'failed':
      return 'bg-red-500'
    case 'stale':
      return 'bg-amber-500'
  }
}

export function getLineColor(status: StepStatus | 'active' | 'stale'): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500'
    case 'failed':
      return 'bg-red-500'
    default:
      return 'bg-gray-700'
  }
}

const STEP_LABELS: Record<string, string> = {
  kb_lookup: 'KB',
  branch: 'Branch',
  brainstorm: 'Brain',
  write_plan: 'Plan',
  implement: 'Impl',
  build: 'Build',
  e2e_local: 'E2E',
  review: 'Review',
  pr: 'PR',
  ci: 'CI',
  e2e_deploy: 'Deploy',
  compact: 'Compact',
  handoff: 'Handoff',
  investigate: 'Research',
  write: 'Write',
}

export function getStepLabel(step: string): string {
  return STEP_LABELS[step] ?? step
}

export function getPipelineProgress(pipeline: PipelineState): { done: number; total: number } {
  const order = getStepOrder(pipeline.pipeline, pipeline.size)
  let done = 0
  let total = 0
  for (const step of order) {
    const state = pipeline.steps[step]
    if (state?.status === 'skipped') continue
    total++
    if (state?.status === 'done') done++
  }
  return { done, total }
}

// ── Attention classification ─────────────────────────────────────────────────

export type AttentionLane = 'needs_you' | 'running' | 'done'

export interface ClassifiedPipeline {
  pipeline: PipelineState
  lane: AttentionLane
  reason: string | null
  progress: { done: number; total: number }
  activeStep: string | null
}

export function getAttentionReason(p: PipelineState): string | null {
  const order = getStepOrder(p.pipeline, p.size)
  for (const step of order) {
    const state = p.steps[step]
    if (state?.status === 'failed') {
      return `${getStepLabel(step)} failed`
    }
  }

  if (p.stale) {
    const active = getActiveStep(p)
    if (active && ['review', 'pr'].includes(active)) {
      return `Stale — may need review`
    }
    return 'Stale — no heartbeat'
  }

  return null
}

export function classifyPipeline(p: PipelineState): ClassifiedPipeline {
  const progress = getPipelineProgress(p)
  const activeStep = getActiveStep(p)
  const reason = getAttentionReason(p)

  let lane: AttentionLane
  if (reason) {
    lane = 'needs_you'
  } else if (progress.done >= progress.total) {
    lane = 'done'
  } else {
    lane = 'running'
  }

  return { pipeline: p, lane, reason, progress, activeStep }
}

export function classifyAndGroup(pipelines: PipelineState[]): Record<AttentionLane, ClassifiedPipeline[]> {
  const groups: Record<AttentionLane, ClassifiedPipeline[]> = {
    needs_you: [],
    running: [],
    done: [],
  }

  for (const p of pipelines) {
    const c = classifyPipeline(p)
    groups[c.lane].push(c)
  }

  // Sort: needs_you by failed-first then stale, running by elapsed desc, done by elapsed desc
  groups.needs_you.sort((a, b) => {
    const aFailed = a.reason?.includes('failed') ? 0 : 1
    const bFailed = b.reason?.includes('failed') ? 0 : 1
    return aFailed - bFailed
  })
  groups.running.sort((a, b) =>
    new Date(a.pipeline.started_at).getTime() - new Date(b.pipeline.started_at).getTime()
  )
  groups.done.sort((a, b) =>
    new Date(b.pipeline.started_at).getTime() - new Date(a.pipeline.started_at).getTime()
  )

  return groups
}

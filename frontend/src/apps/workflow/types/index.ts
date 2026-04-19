export type StepStatus = 'done' | 'pending' | 'skipped' | 'failed'

export interface StepState {
  status: StepStatus
  value?: string | number
  reason?: string
  error?: string
}

export type PipelineType = 'code' | 'research' | 'docs' | 'solo-commit'
export type PipelineSize = 'small' | 'medium' | 'large'

export interface PipelineState {
  task_id: number
  title: string
  type: string
  domain: string | null
  session_id: string
  pipeline: PipelineType
  size: PipelineSize
  started_at: string
  heartbeat_at: string | null
  stale: boolean
  steps: Record<string, StepState>
}

export interface PipelineStateResponse {
  pipelines: PipelineState[]
}

export type SessionLivenessReason =
  | 'dead_pid'
  | 'pid_and_heartbeat'
  | 'pid_and_fresh_file'
  | 'stale_pid_reuse'

export interface Session {
  sessionId: string
  pid: number
  alive: boolean
  cwd: string
  startedAt: string
  age_hours: number | null
  liveness_reason: SessionLivenessReason
  name: string | null
  task_id: number | null
  heartbeat_at: string | null
}

export interface ProgressSummary {
  total: number
  done: number
  in_progress: number
  open: number
  percent: number
}

export interface Task {
  id: number
  title: string
  type: string
  priority: string
  status: string
  domain: string | null
  project_id: string
  project_name: string
  pr_number: number | null
  branch: string | null
  spec_path: string | null
  description: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  phase: string
  parent_id: number | null
  due_date: string | null
  slug?: string | null
  /** Only present for parent-type rows (initiative/epic) */
  children_count?: number
  /** Only present for parent-type rows (initiative/epic) */
  progress?: ProgressSummary
}

/** Minimal ancestor/sibling/child reference — returned by /api/tasks/:id/detail */
export interface TaskRef {
  id: number
  title: string
  type: string
  status: string
  priority: string
  parent_id: number | null
  project_id?: string
  slug?: string | null
  children_count?: number
  progress?: ProgressSummary
}

export interface TreeNode extends TaskRef {
  project_name?: string
  domain?: string | null
  due_date?: string | null
  slug?: string | null
  children: TreeNode[]
  children_count?: number
  progress?: ProgressSummary
}

export interface TreeResponse {
  tree: TreeNode
  ancestors: TaskRef[]
}

export type Context = 'work' | 'family' | 'personal'

export interface RoadmapItem {
  id: number
  title: string
  type: string
  status: string
  priority: string
  parent_id: number | null
  project_id: string
  project_name: string
  domain: string | null
  due_date: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  children_count: number
  progress: ProgressSummary
  context: Context | null
  project_context: Context | null
  slug?: string | null
}

export interface ProjectInsights {
  project_id: string
  project_name: string
  context: Context | null
  priority: string | null
  mode: string | null
  repo_path: string | null
  open_count: number
  in_progress_count: number
  backlog_count: number
  done_count: number
  active_epic_count: number
  stale_count: number
  done_14d: number
  overdue_count: number
  critical_count: number
  high_count: number
  top_priority: string | null
  last_activity: string | null
}

export interface ProjectSummary {
  project_id: string
  project_name: string
  open_count: number
  in_progress_count: number
  done_count: number
}

export type DetailTarget =
  | { kind: 'step'; pipeline: PipelineState; stepName: string }
  | { kind: 'pipeline'; pipeline: PipelineState }
  | { kind: 'session'; session: Session }
  | { kind: 'task'; task: Task }

export interface InsightsFlowEfficiency {
  size: string
  avg_duration_s: number
  min_duration_s: number
  max_duration_s: number
  count: number
}

export interface InsightsStep {
  name: string
  avg_duration_s: number
  skip_rate: number
  fail_rate: number
  count: number
}

export interface InsightsAlert {
  type: 'bottleneck' | 'high_fail' | 'high_skip'
  step: string
  value?: number
  message: string
}

export interface InsightsResponse {
  flow_efficiency: InsightsFlowEfficiency[]
  steps: InsightsStep[]
  alerts: InsightsAlert[]
  total_runs: number
  period: string
}

export type TaskKind = 'default' | 'advisor' | 'brainstorm'
export type AccountHealth = 'active' | 'idle' | 'auth_failure' | 'untested'

export interface SchedulerTask {
  name: string
  slug: string
  schedule: string
  kind?: TaskKind
  enabled: boolean
  model: string
  max_turns: number
  timeout: number
  tools: string[]
  workdir: string
  file_path: string
  prompt: string
  account?: string | null
  last_status?: string | null
  last_run_at?: string | null
  next_run_at?: string | null
  run_count?: number
}

export interface Account {
  id: string
  name: string
  kind: 'config_dir' | 'api_key'
  config_dir: string | null
  api_key_ref: string | null
  plan_tier: string | null
  is_default: boolean
  created_at: string
  last_used_at: string | null
  runs_24h?: number
  failures_24h?: number
  cost_30d_usd?: number
  auth_failure_recent?: boolean
  health?: AccountHealth
}

export type AccountTestResult = {
  ok: boolean
  exit_code: number | null
  stderr_tail: string
  took_ms: number
}

export interface AccountCreatePayload {
  name: string
  kind: 'config_dir' | 'api_key'
  config_dir?: string
  api_key_ref?: string
  plan_tier?: string | null
  is_default?: boolean
}

export interface AccountDiscoverCandidate {
  config_dir: string
  name_suggestion: string
  dir_exists: boolean
  has_credentials: boolean
  has_history: boolean
  already_registered: boolean
  registered_account_id: string | null
}

export interface AccountDiscoverResponse {
  candidates: AccountDiscoverCandidate[]
}

export interface AccountImportPayload {
  name: string
  config_dir: string
  plan_tier?: string | null
  is_default?: boolean
  skip_credentials_check?: boolean
}

export type AccountNameCheck = { available: boolean; reason?: string }

export type AccountCredentialCheck = {
  dir_exists: boolean
  has_credentials: boolean
  expanded_path: string
}

export interface RunRecord {
  id: number
  task_name: string
  status: string
  started_at: string | null
  finished_at: string | null
  duration_seconds: number | null
  cost_usd: number
  error: string | null
}

export interface ErrorRecord {
  message: string
  timestamp: string | null
  task_name: string
}

export interface SchedulerStats {
  total_tasks: number
  enabled: number
  disabled: number
  total_runs: number
  successes: number
  failures: number
  total_cost: number
}

export interface Ticket {
  id: number
  task_name: string
  message: string
  status: string
  created_at?: string | null
}

export interface Notification {
  id: number
  message: string
  read: boolean
  created_at?: string | null
  task_name?: string | null
}

export interface HealthCheck {
  name: string
  ok: boolean
  detail: string
}

export interface LogResponse {
  task_name: string
  log_file: string | null
  content: string
}

export interface Approval {
  id: number
  task_name: string
  status: string
  created_at?: string | null
  artifact_id?: number | null
  artifact?: ArtifactRecord | null
}

export interface ArtifactRecord {
  id: number
  task_name: string
  content: string
  content_type?: string | null
  created_at?: string | null
}

export interface TaskDetailResponse {
  task: SchedulerTask
  runs: RunRecord[]
  errors: ErrorRecord[]
}

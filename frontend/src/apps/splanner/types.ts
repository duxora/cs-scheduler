export type Context = 'work' | 'family' | 'personal'
export type ObjectiveStatus = 'on_track' | 'at_risk' | 'blocked' | 'done'
export type ItemStatus = 'todo' | 'doing' | 'blocked' | 'done'
export type CheckinKind = 'win' | 'risk' | 'decision' | 'blocked' | 'note'
export type CheckinSource = 'manual' | 'calendar' | 'tkt' | 'life-graph'
export type DigestState = 'drafted' | 'needs_review' | 'approved'
export type DigestRiskSeverity = 'high' | 'medium' | 'low'
export type DigestNudgeType = 'stale_objective' | 'pace' | 'missing_win'

export interface ProjectHealth {
  on_track: number
  at_risk: number
  blocked: number
  done: number
}

export interface LatestCheckinSummary {
  body: string
  kind: CheckinKind
  created_at: string
}

export interface Project {
  id: number
  context: Context
  name: string
  priority: number
  status: string
  archived: boolean
  created_at: string
  health: ProjectHealth
  items_blocked: number
  latest_checkin: LatestCheckinSummary | null
  is_blocked: boolean
}

export interface Item {
  id: number
  objective_id: number
  name: string
  status: ItemStatus
  eta: string | null
  blockers: string | null
  tkt_ticket_id: number | null
  created_at: string
}

export interface Objective {
  id: number
  project_id: number
  name: string
  metric: string | null
  target: number | null
  current: number | null
  unit: string | null
  deadline: string | null
  status: ObjectiveStatus
  created_at: string
  items: Item[]
}

export interface Checkin {
  id: number
  project_id: number | null
  objective_id: number | null
  item_id: number | null
  body: string
  kind: CheckinKind
  source: CheckinSource
  source_ref: string | null
  ai_classified: boolean
  suggested_level: 'project' | 'objective' | 'item' | null
  suggested_id: number | null
  created_at: string
}

export interface ProjectDetail {
  project: Project
  objectives: Objective[]
  checkins: Checkin[]
}

export interface KpiDelta {
  objective_id: number
  project_id: number
  objective_name: string
  project_name: string
  metric: string | null
  unit: string | null
  target: string | null
  current: string | null
  prev_current: string | null
}

export interface DigestRisk {
  title: string
  severity: DigestRiskSeverity
  evidence_count: number
}

export interface DigestNudge {
  type: DigestNudgeType
  message: string
  project_id: number | null
}

export interface FocusItem {
  text: string
  accepted: boolean
}

export interface Digest {
  id: number
  week_start: string
  state: DigestState
  narrative_md: string
  kpi_deltas: KpiDelta[]
  risks: DigestRisk[]
  nudges: DigestNudge[]
  focus: FocusItem[]
  created_at: string
}

export interface CreateProjectPayload {
  context: Context
  name: string
  priority?: number
}

export interface UpdateProjectPayload {
  name?: string
  priority?: number
  archived?: boolean
}

export interface CreateObjectivePayload {
  project_id: number
  name: string
  metric?: string | null
  target?: number | null
  unit?: string | null
  deadline?: string | null
}

export interface UpdateObjectivePayload {
  name?: string
  metric?: string | null
  target?: number | null
  current?: number | null
  unit?: string | null
  deadline?: string | null
  status?: ObjectiveStatus
}

export interface CreateItemPayload {
  objective_id: number
  name: string
  eta?: string | null
  tkt_ticket_id?: number | null
}

export interface UpdateItemPayload {
  name?: string
  status?: ItemStatus
  eta?: string | null
  blockers?: string | null
  tkt_ticket_id?: number | null
}

export interface CreateCheckinPayload {
  body: string
  kind?: CheckinKind
  project_id?: number | null
  objective_id?: number | null
  item_id?: number | null
}

export interface UpdateCheckinPayload {
  kind?: CheckinKind
  project_id?: number | null
  objective_id?: number | null
  item_id?: number | null
}

export interface UpdateDigestPayload {
  narrative_md?: string
  focus?: FocusItem[]
}

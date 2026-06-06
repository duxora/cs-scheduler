export type Context = 'work' | 'family' | 'personal'

export interface Project {
  id: number
  context: Context
  name: string
  priority: number
  status: string
  archived: boolean
  created_at: string
}

export interface Item {
  id: number
  objective_id: number
  name: string
  status: string
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
  status: string
  created_at: string
  items: Item[]
}

export interface Checkin {
  id: number
  project_id: number | null
  objective_id: number | null
  item_id: number | null
  body: string
  kind: string
  source: string
  source_ref: string | null
  ai_classified: boolean
  created_at: string
}

export interface ProjectDetail {
  project: Project
  objectives: Objective[]
  checkins: Checkin[]
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

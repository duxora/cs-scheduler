import type {
  Checkin,
  CheckinKind,
  CheckinSource,
  Context,
  CreateCheckinPayload,
  CreateItemPayload,
  CreateObjectivePayload,
  CreateProjectPayload,
  Item,
  Objective,
  Project,
  ProjectDetail,
  UpdateItemPayload,
  UpdateObjectivePayload,
  UpdateProjectPayload,
} from '../types'

const BASE = '/splanner/api'

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  if (body && typeof body === 'object') {
    if ('detail' in body && typeof body.detail === 'string') return body.detail
    if ('error' in body && typeof body.error === 'string') return body.error
  }
  return `${res.status} ${res.statusText}`
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<T>
}

export const splannerApi = {
  listProjects: (params?: { context?: Context; includeArchived?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.context) qs.set('context', params.context)
    if (params?.includeArchived) qs.set('include_archived', '1')
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return fetchJson<Project[]>(`/projects${query}`)
  },

  createProject: (payload: CreateProjectPayload) =>
    fetchJson<Project>('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateProject: (projectId: number, payload: UpdateProjectPayload) =>
    fetchJson<Project>(`/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  getProjectDetail: (projectId: number) =>
    fetchJson<ProjectDetail>(`/projects/${projectId}`),

  createObjective: (payload: CreateObjectivePayload) =>
    fetchJson<Objective>('/objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateObjective: (objectiveId: number, payload: UpdateObjectivePayload) =>
    fetchJson<Objective>(`/objectives/${objectiveId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  createItem: (payload: CreateItemPayload) =>
    fetchJson<Item>('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateItem: (itemId: number, payload: UpdateItemPayload) =>
    fetchJson<Item>(`/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  listCheckins: (params?: { projectId?: number; kind?: CheckinKind; source?: CheckinSource }) => {
    const qs = new URLSearchParams()
    if (params?.projectId !== undefined) qs.set('project_id', String(params.projectId))
    if (params?.kind) qs.set('kind', params.kind)
    if (params?.source) qs.set('source', params.source)
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return fetchJson<Checkin[]>(`/checkins${query}`)
  },

  createCheckin: (payload: CreateCheckinPayload) =>
    fetchJson<Checkin>('/checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
}

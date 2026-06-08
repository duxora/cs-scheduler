import type {
  ApplyResult,
  Checkin,
  CheckinKind,
  CheckinSource,
  ConnectorStatus,
  ConvertResult,
  Context,
  CreateEpicPayload,
  CreateEpicResult,
  CreateTicketResult,
  CreateCheckinPayload,
  Digest,
  DiscussionMessage,
  CreateItemPayload,
  CreateObjectivePayload,
  PollResult,
  ProposalOp,
  CreateProjectPayload,
  Item,
  Objective,
  Project,
  ProjectDetail,
  TktProjectsResponse,
  UpdateItemPayload,
  UpdateCheckinPayload,
  UpdateDigestPayload,
  UpdateObjectivePayload,
  UpdateProjectPayload,
} from '../types'

const BASE = '/splanner/api'

async function readError(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  if (body && typeof body === 'object') {
    if ('detail' in body) {
      const detail = body.detail
      if (typeof detail === 'string') return detail
      return JSON.stringify(detail)
    }
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

  updateCheckin: (checkinId: number, payload: UpdateCheckinPayload) =>
    fetchJson<Checkin>(`/checkins/${checkinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  draftDigest: (weekStart?: string) => {
    const query = weekStart ? `?${new URLSearchParams({ week_start: weekStart }).toString()}` : ''
    return fetchJson<Digest>(`/digest/draft${query}`, {
      method: 'POST',
    })
  },

  getLatestDigest: () =>
    fetchJson<Digest>('/digest/latest'),

  listDigests: () =>
    fetchJson<Digest[]>('/digests'),

  updateDigest: (digestId: number, payload: UpdateDigestPayload) =>
    fetchJson<Digest>(`/digest/${digestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  approveDigest: (digestId: number) =>
    fetchJson<Digest>(`/digest/${digestId}/approve`, {
      method: 'POST',
    }),

  listConnectors: () =>
    fetchJson<ConnectorStatus[]>('/connectors'),

  pollConnector: (name: string) =>
    fetchJson<PollResult>(`/connectors/${name}/poll`, {
      method: 'POST',
    }),

  createTicketFromItem: (itemId: number, tktProject?: string | null) =>
    fetchJson<CreateTicketResult>(`/items/${itemId}/create-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tkt_project: tktProject ?? null }),
    }),

  listTktProjects: (suggestForObjective?: number) => {
    const qs = new URLSearchParams()
    if (suggestForObjective !== undefined) qs.set('suggest_for_objective', String(suggestForObjective))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return fetchJson<TktProjectsResponse>(`/tkt/projects${query}`)
  },

  createEpic: (objectiveId: number, payload: CreateEpicPayload) =>
    fetchJson<CreateEpicResult>(`/objectives/${objectiveId}/create-epic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  getDiscussion: (projectId: number) =>
    fetchJson<{ messages: DiscussionMessage[] }>(`/projects/${projectId}/discussion`),

  postDiscussionMessage: (projectId: number, text: string) =>
    fetchJson<DiscussionMessage>(`/projects/${projectId}/discussion/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  convertDiscussion: (projectId: number) =>
    fetchJson<ConvertResult>(`/projects/${projectId}/discussion/convert`, {
      method: 'POST',
    }),

  applyDiscussion: (projectId: number, ops: ProposalOp[]) =>
    fetchJson<ApplyResult>(`/projects/${projectId}/discussion/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
    }),
}

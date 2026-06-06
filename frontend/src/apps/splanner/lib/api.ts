import type {
  Context,
  CreateProjectPayload,
  Project,
  ProjectDetail,
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
}

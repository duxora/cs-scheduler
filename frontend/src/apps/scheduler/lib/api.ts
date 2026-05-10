import type {
  SchedulerTask,
  TaskKind,
  Account,
  AccountCreatePayload,
  AccountDiscoverResponse,
  AccountImportPayload,
  AccountCredentialCheck,
  AccountNameCheck,
  AccountTestResult,
  RunRecord,
  ErrorRecord,
  SchedulerStats,
  Ticket,
  Notification,
  HealthCheck,
  LogResponse,
  Approval,
  TaskDetailResponse,
} from '../types'

const BASE = '/scheduler/api'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function postForm(path: string, data: Record<string, string | number | boolean>): Promise<Response> {
  const formData = new FormData()
  for (const [key, value] of Object.entries(data)) {
    formData.append(key, String(value))
  }
  const res = await fetch(`/scheduler${path}`, { method: 'POST', body: formData })
  return res
}

async function postJson(path: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST' })
  return res
}

export const schedulerApi = {
  getTasks: () => fetchJson<SchedulerTask[]>('/tasks'),

  listAccounts: () => fetchJson<Account[]>('/accounts'),

  getTask: (slug: string) => fetchJson<TaskDetailResponse>(`/tasks/${slug}`),

  getStats: () => fetchJson<SchedulerStats>('/stats'),

  getHistory: (params?: { task?: string; n?: number }) => {
    const qs = new URLSearchParams()
    if (params?.task) qs.set('task', params.task)
    if (params?.n) qs.set('n', String(params.n))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return fetchJson<RunRecord[]>(`/history${query}`)
  },

  getErrors: (task?: string) => {
    const qs = task ? `?task=${encodeURIComponent(task)}` : ''
    return fetchJson<ErrorRecord[]>(`/errors${qs}`)
  },

  getTickets: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    return fetchJson<Ticket[]>(`/tickets${qs}`)
  },

  getNotifications: (showAll?: boolean) => {
    const qs = showAll ? '?all=true' : ''
    return fetchJson<Notification[]>(`/notifications${qs}`)
  },

  getDoctor: () => fetchJson<HealthCheck[]>('/doctor'),

  getLogs: (slug: string) => fetchJson<LogResponse>(`/logs/${slug}`),

  getApprovals: () => fetchJson<Approval[]>('/approvals'),

  runTask: (slug: string) => postJson(`/run/${slug}`),

  toggleTask: (slug: string) => postJson(`/toggle/${slug}`),

  resolveTicket: (id: number) => postJson(`/tickets/${id}/approve`),

  markNotificationsRead: () => postJson('/notifications/mark-read'),

  approveApproval: (id: number) => postJson(`/approvals/${id}/approve`),

  rejectApproval: (id: number) => postJson(`/approvals/${id}/reject`),

  createTask: (data: {
    name: string
    schedule: string
    kind?: TaskKind
    prompt: string
    model: string
    max_turns: number
    timeout: number
    tools: string
    workdir: string
    enabled: boolean
    account?: string
  }) => postForm('/tasks-new', data as Record<string, string | number | boolean>),

  createAccount: async (payload: AccountCreatePayload): Promise<Account> => {
    const res = await fetch(`${BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json()
  },

  discoverAccounts: async (): Promise<AccountDiscoverResponse> => {
    const res = await fetch(`${BASE}/accounts/discover`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  importAccount: async (payload: AccountImportPayload): Promise<Account> => {
    const res = await fetch(`${BASE}/accounts/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json()
  },

  checkAccountName: async (name: string): Promise<AccountNameCheck> => {
    const res = await fetch(`${BASE}/accounts/check-name?name=${encodeURIComponent(name)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  checkAccountCredentials: async (configDir: string): Promise<AccountCredentialCheck> => {
    const res = await fetch(`${BASE}/accounts/check?config_dir=${encodeURIComponent(configDir)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  deleteAccount: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/accounts/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
  },

  testAccount: async (id: string): Promise<AccountTestResult> => {
    const res = await fetch(`${BASE}/accounts/${id}/test`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  setDefaultAccount: async (id: string): Promise<Account> => {
    const res = await fetch(`${BASE}/accounts/${id}/default`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  updatePrompt: (slug: string, prompt: string) =>
    postForm(`/api/update-prompt/${slug}`, { prompt }),
}

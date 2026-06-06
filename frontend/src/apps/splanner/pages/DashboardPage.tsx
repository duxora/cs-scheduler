import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CheckinComposer from '../components/CheckinComposer'
import { HealthStripe, ObjectiveDots, StackedHealthBar } from '../components/ProjectHealth'
import { splannerApi } from '../lib/api'
import type { CheckinKind, Context, Project } from '../types'

type ContextFilter = 'all' | Context

const CONTEXT_TABS: Array<{ key: ContextFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'work', label: 'Work' },
  { key: 'family', label: 'Family' },
  { key: 'personal', label: 'Personal' },
]

const CONTEXT_STYLES: Record<Context, string> = {
  work: 'bg-blue-400',
  family: 'bg-emerald-400',
  personal: 'bg-amber-400',
}

function ContextDot({ context }: { context: Context }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${CONTEXT_STYLES[context]}`} aria-hidden="true" />
}

function formatContextLabel(context: Context): string {
  return context.charAt(0).toUpperCase() + context.slice(1)
}

const CHECKIN_KIND_STYLES: Record<CheckinKind, string> = {
  win: 'border-emerald-800 bg-emerald-950/40 text-emerald-300',
  risk: 'border-amber-800 bg-amber-950/40 text-amber-300',
  decision: 'border-blue-800 bg-blue-950/40 text-blue-300',
  blocked: 'border-red-800 bg-red-950/40 text-red-300',
  note: 'border-gray-700 bg-gray-900 text-gray-300',
}

function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const diffMs = date.getTime() - Date.now()
  const absSeconds = Math.abs(Math.round(diffMs / 1000))
  if (absSeconds < 60) return 'just now'

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]

  for (const [unit, secondsPerUnit] of units) {
    if (absSeconds >= secondsPerUnit) {
      const amount = Math.round(diffMs / 1000 / secondsPerUnit)
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit)
    }
  }

  return 'just now'
}

function truncateLine(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export default function DashboardPage() {
  const [selectedContext, setSelectedContext] = useState<ContextFilter>('all')
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    name: '',
    context: 'work' as Context,
    priority: '0',
  })
  const [renameDrafts, setRenameDrafts] = useState<Record<number, string>>({})
  const [priorityDrafts, setPriorityDrafts] = useState<Record<number, string>>({})

  async function loadProjects(context: ContextFilter) {
    setIsLoading(true)
    setError(null)
    try {
      const nextProjects = await splannerApi.listProjects(
        context === 'all' ? undefined : { context },
      )
      setProjects(nextProjects)
      setRenameDrafts(
        Object.fromEntries(nextProjects.map((project) => [project.id, project.name])),
      )
      setPriorityDrafts(
        Object.fromEntries(nextProjects.map((project) => [project.id, String(project.priority)])),
      )
      setSelectedProjectId((prev) =>
        prev !== null && nextProjects.some((project) => project.id === prev)
          ? prev
          : nextProjects[0]?.id ?? null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadProjects(selectedContext)
  }, [selectedContext])

  const headerCount = useMemo(() => {
    if (isLoading) return 'Loading…'
    return `${projects.length} project${projects.length === 1 ? '' : 's'}`
  }, [isLoading, projects.length])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  const kpis = useMemo(() => {
    return projects.reduce(
      (totals, project) => {
        totals.activeProjects += 1
        totals.blockedProjects += project.is_blocked ? 1 : 0
        totals.objectivesAtRisk += project.health.at_risk
        totals.objectivesDone += project.health.done
        return totals
      },
      {
        activeProjects: 0,
        blockedProjects: 0,
        objectivesAtRisk: 0,
        objectivesDone: 0,
      },
    )
  }, [projects])

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = createForm.name.trim()
    const priority = Number.parseInt(createForm.priority, 10)
    if (!name) return
    if (Number.isNaN(priority)) {
      setError('Priority must be a number.')
      return
    }

    setIsCreating(true)
    setError(null)
    try {
      await splannerApi.createProject({
        name,
        context: createForm.context,
        priority,
      })
      setCreateForm({ name: '', context: createForm.context, priority: '0' })
      await loadProjects(selectedContext)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.')
    } finally {
      setIsCreating(false)
    }
  }

  async function updateProject(projectId: number, payload: { name?: string; priority?: number; archived?: boolean }, actionKey: string) {
    setActiveAction(actionKey)
    setError(null)
    try {
      await splannerApi.updateProject(projectId, payload)
      await loadProjects(selectedContext)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleRename(project: Project) {
    const name = (renameDrafts[project.id] ?? '').trim()
    if (!name || name === project.name) return
    await updateProject(project.id, { name }, `rename-${project.id}`)
  }

  async function handleRerank(project: Project) {
    const priority = Number.parseInt(priorityDrafts[project.id] ?? '', 10)
    if (Number.isNaN(priority)) {
      setError(`Priority for "${project.name}" must be a number.`)
      return
    }
    if (priority === project.priority) return
    await updateProject(project.id, { priority }, `priority-${project.id}`)
  }

  async function handleArchive(project: Project) {
    await updateProject(project.id, { archived: !project.archived }, `archive-${project.id}`)
  }

  async function handleCheckinCreated() {
    await loadProjects(selectedContext)
  }

  return (
    <div className="flex min-h-full flex-col bg-gray-950 px-4 py-4 text-gray-100 overflow-y-auto">
      <div className="mb-6 flex flex-col gap-4 border-b border-gray-800 pb-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">SPlanner</h1>
            <p className="text-sm text-gray-500">Executive planning across work, family, and personal scopes.</p>
          </div>
          <span className="text-xs text-gray-500">{headerCount}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {CONTEXT_TABS.map((tab) => {
            const active = tab.key === selectedContext
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelectedContext(tab.key)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'border-gray-500 bg-gray-800 text-gray-100'
                    : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-sm font-medium text-gray-100">Quick check-in</h2>
              <p className="text-xs text-gray-500">Pick a project, then capture the latest signal.</p>
            </div>
            <div className="w-full md:w-72">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500" htmlFor="dashboard-checkin-project">
                Project
              </label>
              <select
                id="dashboard-checkin-project"
                value={selectedProjectId ?? ''}
                onChange={(event) => setSelectedProjectId(Number.parseInt(event.target.value, 10))}
                disabled={projects.length === 0}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {projects.length === 0 ? (
                  <option value="">No projects available</option>
                ) : (
                  projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {selectedProject ? (
            <CheckinComposer
              scope={{ projectId: selectedProject.id, label: selectedProject.name }}
              onCreated={handleCheckinCreated}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
              Create a project first to post a check-in.
            </div>
          )}
        </div>

        <form onSubmit={handleCreateProject} className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-100">New project</h2>
            <span className="text-xs text-gray-500">Name + context + priority</span>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_100px_auto]">
            <input
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Quarterly planning, house reset, summer trip…"
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
            />
            <select
              value={createForm.context}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, context: event.target.value as Context }))}
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
            >
              <option value="work">Work</option>
              <option value="family">Family</option>
              <option value="personal">Personal</option>
            </select>
            <input
              value={createForm.priority}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, priority: event.target.value }))}
              inputMode="numeric"
              placeholder="0"
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isCreating}
              className="rounded-lg border border-gray-700 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCreating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-300" role="alert">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Active projects</div>
            <div className="mt-2 text-2xl font-semibold text-gray-100">{kpis.activeProjects}</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Blocked projects</div>
            <div className="mt-2 text-2xl font-semibold text-red-300">{kpis.blockedProjects}</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Objectives at risk</div>
            <div className="mt-2 text-2xl font-semibold text-amber-300">{kpis.objectivesAtRisk}</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Objectives done</div>
            <div className="mt-2 text-2xl font-semibold text-gray-100">{kpis.objectivesDone}</div>
          </div>
        </div>
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-800 text-sm text-gray-500">
            Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-800 text-sm text-gray-500">
            No projects in this context yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((project) => {
              const renameBusy = activeAction === `rename-${project.id}`
              const priorityBusy = activeAction === `priority-${project.id}`
              const archiveBusy = activeAction === `archive-${project.id}`
              return (
                <article
                  key={project.id}
                  className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900/70 p-4 pl-6 shadow-black/20 transition-colors hover:border-gray-700"
                >
                  <HealthStripe project={project} />
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                        <ContextDot context={project.context} />
                        <span>{formatContextLabel(project.context)}</span>
                        {project.is_blocked ? (
                          <span className="rounded-full border border-red-800 bg-red-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
                            Blocked
                          </span>
                        ) : null}
                      </div>
                      <h2 className="truncate text-sm font-semibold text-gray-100">
                        <Link to={`projects/${project.id}`} className="hover:text-white hover:underline">
                          {project.name}
                        </Link>
                      </h2>
                    </div>
                    <div className="shrink-0 rounded-full border border-gray-700 bg-gray-950 px-2.5 py-1 text-xs font-medium text-gray-300">
                      P{project.priority}
                    </div>
                  </div>

                  <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_auto]">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
                        <span>Objective health</span>
                        <span>
                          {project.health.on_track + project.health.at_risk + project.health.blocked + project.health.done}
                        </span>
                      </div>
                      <StackedHealthBar health={project.health} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">Objectives</div>
                      <ObjectiveDots health={project.health} />
                    </div>
                  </div>

                  {project.latest_checkin ? (
                    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHECKIN_KIND_STYLES[project.latest_checkin.kind]}`}
                      >
                        {project.latest_checkin.kind}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-300">
                        {truncateLine(project.latest_checkin.body, 140)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatRelativeTime(project.latest_checkin.created_at)}
                      </span>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_auto]">
                    <div>
                      <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500" htmlFor={`rename-${project.id}`}>
                        Rename
                      </label>
                      <div className="flex gap-2">
                        <input
                          id={`rename-${project.id}`}
                          value={renameDrafts[project.id] ?? ''}
                          onChange={(event) => setRenameDrafts((prev) => ({ ...prev, [project.id]: event.target.value }))}
                          className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRename(project)}
                          disabled={renameBusy}
                          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {renameBusy ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500" htmlFor={`priority-${project.id}`}>
                        Re-rank
                      </label>
                      <div className="flex gap-2">
                        <input
                          id={`priority-${project.id}`}
                          value={priorityDrafts[project.id] ?? ''}
                          onChange={(event) => setPriorityDrafts((prev) => ({ ...prev, [project.id]: event.target.value }))}
                          inputMode="numeric"
                          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRerank(project)}
                          disabled={priorityBusy}
                          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {priorityBusy ? 'Saving…' : 'Set'}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => void handleArchive(project)}
                        disabled={archiveBusy}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {archiveBusy ? 'Saving…' : project.archived ? 'Restore' : 'Archive'}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

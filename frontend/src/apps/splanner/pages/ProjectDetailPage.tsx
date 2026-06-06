import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import CheckinComposer, { type CheckinComposerScope } from '../components/CheckinComposer'
import CheckinStream from '../components/CheckinStream'
import { splannerApi } from '../lib/api'
import type {
  Context,
  CreateObjectivePayload,
  ItemStatus,
  Objective,
  ObjectiveStatus,
  ProjectDetail,
} from '../types'

const CONTEXT_STYLES: Record<Context, string> = {
  work: 'bg-blue-400',
  family: 'bg-emerald-400',
  personal: 'bg-amber-400',
}

const OBJECTIVE_STATUS_STYLES: Record<ObjectiveStatus, string> = {
  on_track: 'border-emerald-800 bg-emerald-950/40 text-emerald-300',
  at_risk: 'border-amber-800 bg-amber-950/40 text-amber-300',
  blocked: 'border-red-800 bg-red-950/40 text-red-300',
  done: 'border-gray-700 bg-gray-900 text-gray-300',
}

const ITEM_STATUS_STYLES: Record<ItemStatus, string> = {
  todo: 'text-gray-300',
  doing: 'text-blue-300',
  blocked: 'text-red-300',
  done: 'text-emerald-300',
}

interface ObjectiveFormState {
  name: string
  metric: string
  target: string
  unit: string
  deadline: string
}

interface ItemFormState {
  name: string
  eta: string
}

const EMPTY_OBJECTIVE_FORM: ObjectiveFormState = {
  name: '',
  metric: '',
  target: '',
  unit: '',
  deadline: '',
}

function formatContextLabel(context: Context): string {
  return context.charAt(0).toUpperCase() + context.slice(1)
}

function formatObjectiveStatus(status: ObjectiveStatus): string {
  return status.replace('_', ' ')
}

function formatMetricLine(objective: Objective): string {
  const current = objective.current ?? 0
  const target = objective.target ?? 0
  const unit = objective.unit ? ` ${objective.unit}` : ''
  return `${current} vs ${target}${unit}`
}

function buildProjectScope(detail: ProjectDetail): CheckinComposerScope {
  return {
    projectId: detail.project.id,
    label: detail.project.name,
  }
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) return 'No deadline'
  const date = new Date(deadline)
  if (Number.isNaN(date.getTime())) return deadline
  return date.toLocaleDateString()
}

function StatusBadge({ status }: { status: ObjectiveStatus }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${OBJECTIVE_STATUS_STYLES[status]}`}
    >
      {formatObjectiveStatus(status)}
    </span>
  )
}

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const parsedProjectId = Number.parseInt(projectId ?? '', 10)
  const projectIdValue = Number.isNaN(parsedProjectId) ? null : parsedProjectId

  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [expandedObjectives, setExpandedObjectives] = useState<Record<number, boolean>>({})
  const [showObjectiveForm, setShowObjectiveForm] = useState(false)
  const [objectiveForm, setObjectiveForm] = useState<ObjectiveFormState>(EMPTY_OBJECTIVE_FORM)
  const [itemForms, setItemForms] = useState<Record<number, ItemFormState>>({})
  const [composerScope, setComposerScope] = useState<CheckinComposerScope | null>(null)

  async function loadProjectDetail(nextProjectId: number) {
    setIsLoading(true)
    setError(null)
    try {
      const nextDetail = await splannerApi.getProjectDetail(nextProjectId)
      setDetail(nextDetail)
      setComposerScope((prev) =>
        prev && prev.projectId === nextDetail.project.id ? prev : buildProjectScope(nextDetail),
      )
      setExpandedObjectives((prev) => {
        const next = { ...prev }
        for (const objective of nextDetail.objectives) {
          if (next[objective.id] === undefined) next[objective.id] = true
        }
        return next
      })
      setItemForms((prev) => {
        const next = { ...prev }
        for (const objective of nextDetail.objectives) {
          if (!next[objective.id]) next[objective.id] = { name: '', eta: '' }
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project detail.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (projectIdValue === null) {
      setError('Invalid project id.')
      setIsLoading(false)
      return
    }
    void loadProjectDetail(projectIdValue)
  }, [projectIdValue])

  const totals = useMemo(() => {
    const objectiveCount = detail?.objectives.length ?? 0
    const itemCount = detail?.objectives.reduce((sum, objective) => sum + objective.items.length, 0) ?? 0
    return `${objectiveCount} objective${objectiveCount === 1 ? '' : 's'} · ${itemCount} item${itemCount === 1 ? '' : 's'}`
  }, [detail])

  function toggleObjective(objectiveId: number) {
    setExpandedObjectives((prev) => ({ ...prev, [objectiveId]: !prev[objectiveId] }))
  }

  function setProjectComposerScope() {
    if (!detail) return
    setComposerScope(buildProjectScope(detail))
  }

  async function handleCheckinCreated() {
    if (projectIdValue === null) return
    await loadProjectDetail(projectIdValue)
  }

  async function handleCreateObjective(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (projectIdValue === null) return
    const name = objectiveForm.name.trim()
    if (!name) return

    const target = objectiveForm.target.trim()
    const payload: CreateObjectivePayload = {
      project_id: projectIdValue,
      name,
      metric: objectiveForm.metric.trim() || null,
      target: target ? Number(target) : null,
      unit: objectiveForm.unit.trim() || null,
      deadline: objectiveForm.deadline || null,
    }

    if (payload.target !== null && Number.isNaN(payload.target)) {
      setError('Target must be a number.')
      return
    }

    setActiveAction('create-objective')
    setError(null)
    try {
      await splannerApi.createObjective(payload)
      setObjectiveForm(EMPTY_OBJECTIVE_FORM)
      setShowObjectiveForm(false)
      await loadProjectDetail(projectIdValue)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create objective.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleArchiveProject() {
    if (!detail) return
    const confirmed = window.confirm(`Archive "${detail.project.name}"?`)
    if (!confirmed) return

    setActiveAction('archive-project')
    setError(null)
    try {
      await splannerApi.updateProject(detail.project.id, { archived: true })
      navigate('/splanner', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive project.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleItemStatusChange(objectiveId: number, itemId: number, status: ItemStatus) {
    if (projectIdValue === null) return
    setActiveAction(`item-status-${itemId}`)
    setError(null)
    try {
      await splannerApi.updateItem(itemId, { status })
      await loadProjectDetail(projectIdValue)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleCreateItem(event: React.FormEvent<HTMLFormElement>, objectiveId: number) {
    event.preventDefault()
    if (projectIdValue === null) return
    const form = itemForms[objectiveId] ?? { name: '', eta: '' }
    const name = form.name.trim()
    if (!name) return

    setActiveAction(`create-item-${objectiveId}`)
    setError(null)
    try {
      await splannerApi.createItem({
        objective_id: objectiveId,
        name,
        eta: form.eta || null,
      })
      setItemForms((prev) => ({ ...prev, [objectiveId]: { name: '', eta: '' } }))
      await loadProjectDetail(projectIdValue)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create item.')
    } finally {
      setActiveAction(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-gray-950 text-sm text-gray-500">
        Loading project…
      </div>
    )
  }

  if (error && !detail) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-gray-950 px-4 text-gray-300">
        <p className="text-sm text-red-300">{error}</p>
        <Link to="/splanner" className="text-sm text-blue-400 hover:underline">
          ← Back to SPlanner
        </Link>
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className="min-h-full bg-gray-950 px-4 py-4 text-gray-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <Link to="/splanner" className="text-sm text-gray-500 transition-colors hover:text-gray-300">
          ← Back to SPlanner
        </Link>

        <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CONTEXT_STYLES[detail.project.context]}`} aria-hidden="true" />
                <span>{formatContextLabel(detail.project.context)}</span>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-gray-50">{detail.project.name}</h1>
              <p className="mt-2 text-sm text-gray-400">{totals}</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <button
                type="button"
                onClick={() => setShowObjectiveForm((prev) => !prev)}
                className="rounded-lg border border-gray-700 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-white"
              >
                {showObjectiveForm ? 'Close objective form' : 'Add objective'}
              </button>
              <button
                type="button"
                onClick={() => void handleArchiveProject()}
                disabled={activeAction === 'archive-project'}
                className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {activeAction === 'archive-project' ? 'Archiving…' : 'Archive project'}
              </button>
            </div>
          </div>

          {showObjectiveForm && (
            <form onSubmit={handleCreateObjective} className="mt-5 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-100">New objective</h2>
                <span className="text-xs text-gray-500">Name, metric, target, unit, deadline</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_120px_180px_auto]">
                <input
                  value={objectiveForm.name}
                  onChange={(event) => setObjectiveForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Reduce alert fatigue"
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <input
                  value={objectiveForm.metric}
                  onChange={(event) => setObjectiveForm((prev) => ({ ...prev, metric: event.target.value }))}
                  placeholder="Escalations / week"
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <input
                  value={objectiveForm.target}
                  onChange={(event) => setObjectiveForm((prev) => ({ ...prev, target: event.target.value }))}
                  inputMode="decimal"
                  placeholder="3"
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <input
                  value={objectiveForm.unit}
                  onChange={(event) => setObjectiveForm((prev) => ({ ...prev, unit: event.target.value }))}
                  placeholder="alerts"
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <input
                  value={objectiveForm.deadline}
                  onChange={(event) => setObjectiveForm((prev) => ({ ...prev, deadline: event.target.value }))}
                  type="date"
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={activeAction === 'create-objective'}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeAction === 'create-objective' ? 'Saving…' : 'Create'}
                </button>
              </div>
            </form>
          )}
        </section>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-300" role="alert">
            {error}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
          <section className="grid gap-4">
            {detail.objectives.length === 0 ? (
              <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-gray-800 text-sm text-gray-500">
                No objectives yet.
              </div>
            ) : (
              detail.objectives.map((objective) => {
                const isExpanded = expandedObjectives[objective.id] ?? true
                const itemForm = itemForms[objective.id] ?? { name: '', eta: '' }
                const createItemBusy = activeAction === `create-item-${objective.id}`
                return (
                  <article key={objective.id} className="rounded-2xl border border-gray-800 bg-gray-900/70">
                    <div className="flex items-start gap-3 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => toggleObjective(objective.id)}
                        className="flex min-w-0 flex-1 items-start justify-between gap-4 text-left transition-colors hover:text-white"
                      >
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-semibold text-gray-100">{objective.name}</h2>
                            <StatusBadge status={objective.status} />
                          </div>
                          <p className="text-sm text-gray-400">
                            {objective.metric ? `${objective.metric} · ` : ''}
                            {formatMetricLine(objective)}
                            {' · '}
                            {formatDeadline(objective.deadline)}
                          </p>
                        </div>
                        <span className="text-lg text-gray-500">{isExpanded ? '−' : '+'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setComposerScope({
                            projectId: detail.project.id,
                            objectiveId: objective.id,
                            label: objective.name,
                          })
                        }
                        className="rounded-full border border-gray-700 bg-gray-950 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
                      >
                        check-in
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-800 px-5 py-4">
                        <div className="mb-4 space-y-3">
                          {objective.items.length === 0 ? (
                            <p className="text-sm text-gray-500">No items yet.</p>
                          ) : (
                            objective.items.map((item) => {
                              const itemBusy = activeAction === `item-status-${item.id}`
                              return (
                                <div
                                  key={item.id}
                                  className="rounded-xl border border-gray-800 bg-gray-950/70 px-4 py-3"
                                >
                                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium text-gray-100">{item.name}</p>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setComposerScope({
                                              projectId: detail.project.id,
                                              objectiveId: objective.id,
                                              itemId: item.id,
                                              label: `${objective.name} / ${item.name}`,
                                            })
                                          }
                                          className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
                                        >
                                          check-in
                                        </button>
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                        <span className={ITEM_STATUS_STYLES[item.status]}>{item.status}</span>
                                        {item.eta && <span>ETA {formatDeadline(item.eta)}</span>}
                                      </div>
                                      {item.blockers && (
                                        <p className="mt-2 text-sm text-red-300">Blockers: {item.blockers}</p>
                                      )}
                                    </div>
                                    <select
                                      value={item.status}
                                      onChange={(event) =>
                                        void handleItemStatusChange(
                                          objective.id,
                                          item.id,
                                          event.target.value as ItemStatus,
                                        )}
                                      disabled={itemBusy}
                                      className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      <option value="todo">todo</option>
                                      <option value="doing">doing</option>
                                      <option value="blocked">blocked</option>
                                      <option value="done">done</option>
                                    </select>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>

                        <form
                          onSubmit={(event) => void handleCreateItem(event, objective.id)}
                          className="rounded-xl border border-gray-800 bg-gray-950/70 p-4"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-medium text-gray-100">Add item</h3>
                            <span className="text-xs text-gray-500">Name + ETA</span>
                          </div>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                            <input
                              value={itemForm.name}
                              onChange={(event) =>
                                setItemForms((prev) => ({
                                  ...prev,
                                  [objective.id]: { ...itemForm, name: event.target.value },
                                }))
                              }
                              placeholder="Draft the recovery checklist"
                              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                            />
                            <input
                              value={itemForm.eta}
                              onChange={(event) =>
                                setItemForms((prev) => ({
                                  ...prev,
                                  [objective.id]: { ...itemForm, eta: event.target.value },
                                }))
                              }
                              type="date"
                              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
                            />
                            <button
                              type="submit"
                              disabled={createItemBusy}
                              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {createItemBusy ? 'Saving…' : 'Create item'}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </article>
                )
              })
            )}
          </section>

          <aside className="grid gap-4 self-start xl:sticky xl:top-4">
            {composerScope && (
              <CheckinComposer scope={composerScope} onCreated={handleCheckinCreated} />
            )}
            <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-100">Current stream scope</p>
                <p className="text-xs text-gray-500">{composerScope?.label ?? detail.project.name}</p>
              </div>
              <button
                type="button"
                onClick={setProjectComposerScope}
                className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
              >
                Project scope
              </button>
            </div>
            <CheckinStream checkins={detail.checkins} refetch={handleCheckinCreated} />
          </aside>
        </div>
      </div>
    </div>
  )
}

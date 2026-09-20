import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../types'
import { useSWRConfig } from 'swr'
import { Status } from '../lib/tokens'

// ── constants ──────────────────────────────────────────────────────────────

// Derived from tokens so adding a new status only requires updating tokens.ts
const STATUS_OPTIONS = (Object.keys(Status.display) as Array<keyof typeof Status.display>).map(
  (value) => ({ value, label: Status.display[value] }),
)

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

// ── main component ─────────────────────────────────────────────────────────

type BulkAction = 'move' | 'status' | 'priority' | 'delete'

const ALL_ACTIONS: BulkAction[] = ['move', 'status', 'priority', 'delete']

interface BulkActionsProps {
  selectedIds: Set<number>
  projects: ProjectSummary[]
  onClearSelection: () => void
  /** Which action groups to render. Defaults to all four (existing behaviour). */
  enabledActions?: BulkAction[]
}

// Revalidate any SWR key whose data this bar's writes can affect - not just the
// task list keys. The epics screen reads '/workflow/api/roadmap', which is a
// distinct key from '/workflow/api/tasks*' even though the same bulk-update
// endpoint changes the rows it renders.
function isAffectedKey(key: unknown): boolean {
  return typeof key === 'string' && (key.startsWith('/workflow/api/tasks') || key.startsWith('/workflow/api/roadmap'))
}

export default function BulkActions({ selectedIds, projects, onClearSelection, enabledActions = ALL_ACTIONS }: BulkActionsProps) {
  const { mutate } = useSWRConfig()
  const [moveProject, setMoveProject] = useState('')
  const [setStatus, setSetStatus] = useState('')
  const [setPriority, setSetPriority] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  const count = selectedIds.size
  const ids = Array.from(selectedIds)

  // A fresh selection (user checked/unchecked rows) invalidates any prior result message.
  useEffect(() => {
    setResultMessage(null)
  }, [selectedIds])

  const showMove = enabledActions.includes('move')
  const showStatus = enabledActions.includes('status')
  const showPriority = enabledActions.includes('priority')
  const showDelete = enabledActions.includes('delete')

  if (count === 0) return null

  async function post(path: string, body: Record<string, unknown>): Promise<{ updated?: number }> {
    const res = await fetch(`/workflow/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    try {
      return await res.json()
    } catch {
      return {}
    }
  }

  async function handleMove() {
    if (!moveProject) return
    setLoading(true)
    setError(null)
    try {
      await post('/tasks/bulk-move', { task_ids: ids, project_id: moveProject })
      await mutate(isAffectedKey)
      onClearSelection()
      setMoveProject('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSetStatus() {
    if (!setStatus) return
    setLoading(true)
    setError(null)
    try {
      await post('/tasks/bulk-update', { task_ids: ids, status: setStatus })
      await mutate(isAffectedKey)
      onClearSelection()
      setSetStatus('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSetPriority() {
    if (!setPriority) return
    setLoading(true)
    setError(null)
    setResultMessage(null)
    try {
      const selectedCount = count
      const result = await post('/tasks/bulk-update', { task_ids: ids, priority: setPriority })
      await mutate(isAffectedKey)
      // The endpoint skips rows already at the target priority, so `updated` can be
      // lower than `selectedCount` - report what actually changed, not what was selected.
      const updated = typeof result.updated === 'number' ? result.updated : selectedCount
      setResultMessage(`${selectedCount} selected, ${updated} changed`)
      setSetPriority('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Priority update failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteSelected() {
    if (!confirm(`Delete ${count} task${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setLoading(true)
    setError(null)
    try {
      await Promise.all(ids.map((id) => fetch(`/workflow/api/tasks/${id}`, { method: 'DELETE' })))
      await mutate(isAffectedKey)
      onClearSelection()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900 border-t border-gray-700 px-4 py-2.5 flex items-center gap-3 flex-wrap shadow-lg">
      {/* Count */}
      <span className="text-xs font-medium text-gray-300 shrink-0">
        {count} selected
      </span>

      <div className="w-px h-4 bg-gray-700 shrink-0" />

      {/* Move to project */}
      {showMove && (
        <>
          <div className="flex items-center gap-1.5">
            <select
              value={moveProject}
              onChange={(e) => setMoveProject(e.target.value)}
              disabled={loading}
              className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 disabled:opacity-50"
              aria-label="Move to project"
            >
              <option value="">Move to project...</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_name}
                </option>
              ))}
            </select>
            <button
              onClick={handleMove}
              disabled={!moveProject || loading}
              className="text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Move
            </button>
          </div>

          <div className="w-px h-4 bg-gray-700 shrink-0" />
        </>
      )}

      {/* Set status */}
      {showStatus && (
        <>
          <div className="flex items-center gap-1.5">
            <select
              value={setStatus}
              onChange={(e) => setSetStatus(e.target.value)}
              disabled={loading}
              className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 disabled:opacity-50"
              aria-label="Set status"
            >
              <option value="">Set status...</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleSetStatus}
              disabled={!setStatus || loading}
              className="text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
          </div>

          <div className="w-px h-4 bg-gray-700 shrink-0" />
        </>
      )}

      {/* Set priority */}
      {showPriority && (
        <div className="flex items-center gap-1.5">
          <select
            value={setPriority}
            onChange={(e) => setSetPriority(e.target.value)}
            disabled={loading}
            className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 disabled:opacity-50"
            aria-label="Set priority"
          >
            <option value="">Set priority...</option>
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleSetPriority}
            disabled={!setPriority || loading}
            className="text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Apply
          </button>
        </div>
      )}

      {resultMessage && !error && (
        <span className="text-[10px] text-emerald-400 ml-1">{resultMessage}</span>
      )}

      {error && (
        <span className="text-[10px] text-red-400 ml-1">{error}</span>
      )}

      {showDelete && (
        <>
          <div className="w-px h-4 bg-gray-700 shrink-0" />

          {/* Delete selected */}
          <button
            onClick={handleDeleteSelected}
            disabled={loading}
            className="text-xs px-2.5 py-1 bg-red-900/40 border border-red-700/60 rounded text-red-300 hover:bg-red-900/70 hover:border-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Delete {count}
          </button>
        </>
      )}

      <div className="ml-auto">
        <button
          onClick={onClearSelection}
          disabled={loading}
          className="text-xs text-gray-300 hover:text-white transition-colors disabled:opacity-50"
        >
          Clear selection
        </button>
      </div>
    </div>
  )
}

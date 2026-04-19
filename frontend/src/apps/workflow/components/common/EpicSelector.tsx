import { useState } from 'react'
import useSWR, { mutate as swrMutate } from 'swr'
import type { TaskRef } from '../../types'

interface EpicRef {
  id: number
  title: string
  type: string
  status: string
}

interface EpicSelectorProps {
  taskId: number
  projectId: string
  currentParent: TaskRef | null
  onChange: () => void | Promise<void>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function EpicSelector({ taskId, projectId, currentParent, onChange }: EpicSelectorProps) {
  const { data: epics } = useSWR<EpicRef[]>(
    `/workflow/api/roadmap?project=${encodeURIComponent(projectId)}`,
    fetcher,
  )
  const [mode, setMode] = useState<'idle' | 'pick' | 'create'>('idle')
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assignedEpic =
    currentParent && (currentParent.type === 'epic' || currentParent.type === 'initiative')
      ? currentParent
      : null

  const availableEpics = (epics ?? []).filter(
    (e) => e.type === 'epic' && e.status !== 'done' && e.status !== 'cancelled' && e.id !== taskId,
  )

  async function setParent(parentId: number | null) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/workflow/api/tasks/${taskId}/set-parent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: parentId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error ?? `Failed (${res.status})`)
        return
      }
      setMode('idle')
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  async function createAndAssign() {
    const title = newTitle.trim()
    if (!title) return
    setBusy(true); setError(null)
    try {
      // Single server-side transaction — avoids orphan epic if assignment fails.
      const res = await fetch('/workflow/api/epics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, title, assign_to_task_id: taskId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error ?? `Create failed (${res.status})`)
        return
      }
      await swrMutate(`/workflow/api/roadmap?project=${encodeURIComponent(projectId)}`)
      setMode('idle')
      setNewTitle('')
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Epic</p>

      {assignedEpic && mode === 'idle' && (
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 min-w-0 text-slate-200 truncate">
            #{assignedEpic.id} · {assignedEpic.title}
          </span>
          <button
            type="button"
            onClick={() => setParent(null)}
            disabled={busy}
            className="text-[10px] text-slate-500 hover:text-red-400 disabled:opacity-50"
            title="Unassign epic"
          >
            × unassign
          </button>
        </div>
      )}

      {!assignedEpic && mode === 'idle' && (
        <p className="text-xs text-slate-500 italic">No epic assigned</p>
      )}

      {mode === 'idle' && (
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => setMode('pick')}
            className="px-2 py-1 text-[11px] rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {assignedEpic ? 'Change' : 'Pick epic'}
          </button>
          <button
            type="button"
            onClick={() => setMode('create')}
            className="px-2 py-1 text-[11px] rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            + New epic
          </button>
        </div>
      )}

      {mode === 'pick' && (
        <div className="flex flex-col gap-1.5 mt-1">
          <select
            className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value
              if (v) setParent(Number(v))
            }}
            disabled={busy}
          >
            <option value="" disabled>
              {availableEpics.length === 0 ? 'No open epics in this project' : 'Select an epic…'}
            </option>
            {availableEpics.map((e) => (
              <option key={e.id} value={e.id}>
                #{e.id} · {e.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="self-start text-[10px] text-slate-500 hover:text-slate-300"
          >
            cancel
          </button>
        </div>
      )}

      {mode === 'create' && (
        <div className="flex flex-col gap-1.5 mt-1">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTitle.trim()) {
                e.stopPropagation()
                createAndAssign()
              }
              if (e.key === 'Escape') {
                // The drawer listens for Escape at the document level; stop here so
                // canceling the new-epic input doesn't also close the whole drawer.
                e.stopPropagation()
                e.nativeEvent.stopImmediatePropagation()
                setMode('idle')
                setNewTitle('')
              }
            }}
            placeholder="Epic title"
            autoFocus
            className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={createAndAssign}
              disabled={busy || !newTitle.trim()}
              className="px-2 py-1 text-[11px] rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? 'Creating…' : 'Create & assign'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('idle'); setNewTitle('') }}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  )
}

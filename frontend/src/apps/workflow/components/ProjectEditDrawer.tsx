import { useEffect, useRef, useState } from 'react'
import useSWR, { mutate as swrMutate } from 'swr'
import { MODE_KEYS, CONTEXT_KEYS, type ModeKey, type ContextKey } from '../lib/tokens'

interface ProjectDetail {
  id: string
  name: string
  repo_path: string | null
  context: ContextKey | null
  priority: 'critical' | 'high' | 'medium' | 'low' | null
  mode: ModeKey | null
  created_at: string
  archived_at: string | null
}

interface ProjectEditDrawerProps {
  projectId: string | null
  onClose: () => void
}

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface FormState {
  name: string
  repo_path: string
  context: ContextKey | ''
  priority: typeof PRIORITIES[number] | ''
  mode: ModeKey | ''
}

function toForm(p: ProjectDetail): FormState {
  return {
    name: p.name,
    repo_path: p.repo_path ?? '',
    context: p.context ?? '',
    priority: p.priority ?? '',
    mode: p.mode ?? '',
  }
}

export default function ProjectEditDrawer({ projectId, onClose }: ProjectEditDrawerProps) {
  const { data, error, mutate } = useSWR<ProjectDetail>(
    projectId ? `/workflow/api/projects/${encodeURIComponent(projectId)}` : null,
    fetcher,
  )

  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const loadedForId = useRef<string | null>(null)

  // Hydrate form when project data arrives (or switches)
  useEffect(() => {
    if (!data || !projectId) return
    if (loadedForId.current === projectId) return
    loadedForId.current = projectId
    setForm(toForm(data))
    setSaveError(null)
  }, [data, projectId])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Reset loaded marker when drawer closes so re-opening refetches state
  useEffect(() => {
    if (projectId == null) {
      loadedForId.current = null
      setForm(null)
    }
  }, [projectId])

  if (projectId == null) return null

  const dirty =
    form != null && data != null &&
    (form.name !== (data.name ?? '') ||
      form.repo_path !== (data.repo_path ?? '') ||
      form.context !== (data.context ?? '') ||
      form.priority !== (data.priority ?? '') ||
      form.mode !== (data.mode ?? ''))

  async function handleSave() {
    if (!form || !projectId) return
    setSaving(true); setSaveError(null)
    try {
      const payload = {
        name: form.name.trim(),
        repo_path: form.repo_path.trim() || null,
        context: form.context || null,
        priority: form.priority || null,
        mode: form.mode || null,
      }
      const res = await fetch(`/workflow/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body?.error ?? `Save failed (${res.status})`)
        return
      }
      await mutate(body, { revalidate: false })
      // Also refresh the projects-insights list so the Projects page reflects changes
      await swrMutate('/workflow/api/projects-insights')
      // Reopening the same project should not flash stale cache before revalidation.
      loadedForId.current = null
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveToggle() {
    if (!data || !projectId) return
    const archiving = data.archived_at == null
    const confirmMsg = archiving
      ? `Archive "${data.name}"? Its tasks and epics will be hidden from default views. You can restore it later.`
      : `Restore "${data.name}"? Tasks and epics will reappear in default views.`
    if (!window.confirm(confirmMsg)) return

    setArchiving(true); setSaveError(null)
    try {
      const res = await fetch(`/workflow/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: archiving }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body?.error ?? `Update failed (${res.status})`)
        return
      }
      await mutate(body, { revalidate: false })
      await swrMutate('/workflow/api/projects-insights')
      loadedForId.current = null
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed top-0 right-0 z-30 h-full w-full sm:w-[420px] flex flex-col shadow-2xl border-l"
        style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Edit project"
      >
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b" style={{ borderColor: 'var(--wf-border)' }}>
          <div className="flex-1 min-w-0 mr-2">
            <p className="text-[10px] text-gray-500 mb-0.5">Edit project</p>
            <p className="text-sm font-medium text-gray-100 truncate font-mono">{projectId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {error && <p className="text-xs text-red-400">Failed to load project</p>}
          {!data && !error && <p className="text-xs text-gray-600">Loading…</p>}
          {data && form && (
            <div className="flex flex-col gap-4">
              <FormField label="Name">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </FormField>

              <FormField label="Slug (read-only)">
                <input
                  type="text"
                  value={data.id}
                  disabled
                  className="w-full bg-slate-900/40 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-500 font-mono cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Slug is the primary key and can't be renamed here.
                </p>
              </FormField>

              <FormField label="Priority">
                <Segmented
                  options={[
                    { value: '', label: '—' },
                    ...PRIORITIES.map((p) => ({ value: p, label: capitalize(p) })),
                  ]}
                  value={form.priority}
                  onChange={(v) => setForm({ ...form, priority: v as FormState['priority'] })}
                />
              </FormField>

              <FormField label="Mode">
                <Segmented
                  options={[
                    { value: '', label: '—' },
                    ...MODE_KEYS.map((m) => ({ value: m, label: capitalize(m) })),
                  ]}
                  value={form.mode}
                  onChange={(v) => setForm({ ...form, mode: v as FormState['mode'] })}
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Solo = single driver · Team = multiple contributors
                </p>
              </FormField>

              <FormField label="Life area">
                <Segmented
                  options={[
                    { value: '', label: '—' },
                    ...CONTEXT_KEYS.map((c) => ({ value: c, label: capitalize(c) })),
                  ]}
                  value={form.context}
                  onChange={(v) => setForm({ ...form, context: v as FormState['context'] })}
                />
              </FormField>

              <FormField label="Repo path">
                <input
                  type="text"
                  value={form.repo_path}
                  onChange={(e) => setForm({ ...form, repo_path: e.target.value })}
                  placeholder="/absolute/path/to/repo"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </FormField>

              {saveError && (
                <p className="text-xs text-red-400">{saveError}</p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 py-3 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--wf-border)' }}>
          {data && (
            <button
              onClick={handleArchiveToggle}
              disabled={archiving || saving}
              className={
                'px-3 py-1.5 text-xs rounded border disabled:opacity-40 disabled:cursor-not-allowed ' +
                (data.archived_at == null
                  ? 'border-red-900/50 text-red-300 hover:bg-red-950/40'
                  : 'border-emerald-900/50 text-emerald-300 hover:bg-emerald-950/40')
              }
              title={data.archived_at == null
                ? 'Hide this project and its tasks from default views'
                : 'Restore this project to default views'}
            >
              {archiving
                ? '…'
                : data.archived_at == null
                  ? 'Archive'
                  : 'Restore'}
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-3 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

interface SegOption { value: string; label: string }

function Segmented({
  options,
  value,
  onChange,
}: {
  options: readonly SegOption[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2 py-1 text-[11px] rounded border transition-colors ${
            value === opt.value
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'bg-slate-900/40 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { PriorityBadge, StatusBadge } from './ui/Badge'
import { TypeBadge } from './ui/TypeBadge'
import { StatusGlyph } from './ui/StatusGlyph'
import { ProgressBar } from './ui/ProgressBar'
import { TrashIcon } from './ui/icons'
import { ParentBreadcrumb } from './common/ParentBreadcrumb'
import { ParentContextCard } from './common/ParentContextCard'
import { EpicSelector } from './common/EpicSelector'
import { isParentType } from '../lib/tokens'
import type { TaskRef, ProgressSummary } from '../types'
import { treePath } from '../lib/urls'

// ── types ──────────────────────────────────────────────────────────────────

interface TaskDetail {
  id: number
  title: string
  description: string | null
  type: string
  priority: string
  status: string
  domain: string | null
  pr_number: number | null
  branch: string | null
  parent_id: number | null
  project_id: string
  project_name: string
  repo_path: string | null
  spec_path: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  due_date: string | null
  slug?: string | null
}

interface HistoryStep {
  label: string
  timestamp: string
  field: string
}

interface Note {
  content: string
  added_by: string
  created_at: string
}

interface Doc {
  type: 'spec' | 'reference'
  path: string
}

interface TaskDetailResponse {
  task: TaskDetail
  parent: TaskRef | null
  ancestors: TaskRef[]
  children: TaskRef[]
  siblings: TaskRef[]
  progress: ProgressSummary | null
  steps: HistoryStep[]
  notes: Note[]
  docs: Doc[]
}


// ── fetcher ────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs text-gray-300">{children}</p>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────

interface TaskDetailDrawerProps {
  taskId: number | null
  onClose: () => void
  onDelete?: (id: number) => Promise<void>
  /**
   * Switch the drawer to a different task (siblings list).
   * When omitted, falls back to navigating the current task URL param —
   * that works for the TaskBoard route which manages `?task=` itself.
   */
  onNavigate?: (id: number) => void
}

export default function TaskDetailDrawer({ taskId, onClose, onDelete, onNavigate }: TaskDetailDrawerProps) {
  const { data, error, mutate } = useSWR<TaskDetailResponse>(
    taskId != null ? `/workflow/api/tasks/${taskId}/detail` : null,
    fetcher,
  )

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (taskId == null) return null

  return (
    <>
      {/* Overlay backdrop (click to close) */}
      <div
        className="fixed inset-0 z-20"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className="fixed top-0 right-0 z-30 h-full w-full sm:w-[400px] flex flex-col shadow-2xl border-l"
        style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b" style={{ borderColor: 'var(--wf-border)' }}>
          {data ? (
            <div className="flex-1 min-w-0 mr-2">
              {data.ancestors.length > 0 && (
                <div className="mb-1">
                  <ParentBreadcrumb ancestors={data.ancestors} />
                </div>
              )}
              <p className="text-[10px] text-gray-500 mb-0.5">#{data.task.id}</p>
              <p className="text-sm font-medium text-gray-100 truncate">{data.task.title}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">{error ? 'Error loading task' : 'Loading...'}</p>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {data && onDelete && (
              <button
                onClick={async () => {
                  if (confirm(`Delete task #${data.task.id}?\n"${data.task.title}"\n\nThis cannot be undone.`)) {
                    await onDelete(data.task.id)
                    onClose()
                  }
                }}
                className="text-gray-600 hover:text-red-400 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
                aria-label="Delete task"
                title="Delete task"
              >
                <TrashIcon />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
              aria-label="Close drawer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && (
            <p className="text-xs text-red-400">Failed to load task details</p>
          )}
          {!data && !error && (
            <p className="text-xs text-gray-600">Loading...</p>
          )}
          {data && (
            <div className="flex flex-col gap-5">
              {/* Badges */}
              <div className="flex flex-wrap gap-1.5">
                <TypeBadge type={data.task.type} />
                <PriorityBadge priority={data.task.priority} />
                <StatusBadge status={data.task.status} />
                {data.task.domain && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                    {data.task.domain}
                  </span>
                )}
              </div>

              {/* Parent context — shown only when this task has a parent */}
              {data.parent && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Parent</p>
                  <ParentContextCard
                    parent={data.parent}
                    root={data.ancestors.length > 1 ? data.ancestors[data.ancestors.length - 1] : null}
                  />
                </div>
              )}

              {/* Epic selector — leaf-task rows (exclude initiative, which has no meaningful parent here) */}
              {data.task.type !== 'initiative' && (
                <EpicSelector
                  taskId={data.task.id}
                  projectId={data.task.project_id}
                  currentParent={data.parent}
                  onChange={async () => { await mutate() }}
                />
              )}

              {/* Progress — shown only for parent-type rows */}
              {isParentType(data.task.type) && data.progress && data.progress.total > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Progress</p>
                  <ProgressBar
                    done={data.progress.done}
                    total={data.progress.total}
                    showCounts
                    showPercent
                    height={2}
                  />
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                    <span><span className="text-emerald-400 font-medium">{data.progress.done}</span> done</span>
                    <span><span className="text-amber-400 font-medium">{data.progress.in_progress}</span> in flight</span>
                    <span><span className="text-blue-400 font-medium">{data.progress.open}</span> open</span>
                  </div>
                  <Link
                    to={treePath(data.task.id, data.task.slug)}
                    className="mt-2 inline-block text-[11px] text-indigo-400 hover:text-indigo-300"
                  >
                    Open full tree →
                  </Link>
                </div>
              )}

              {/* Children list (parent rows only) */}
              {data.children.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                    Children ({data.children.length})
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {data.children.map((c) => (
                      <li key={c.id}>
                        <Link
                          to={treePath(c.id, c.slug)}
                          className="flex items-center gap-2 py-1 px-1.5 rounded text-xs hover:bg-slate-800/60 transition-colors"
                        >
                          <StatusGlyph status={c.status} />
                          <TypeBadge type={c.type} />
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">#{c.id}</span>
                          <span className="flex-1 min-w-0 text-slate-200 truncate">{c.title}</span>
                          {c.progress && c.progress.total > 0 && (
                            <span className="text-[10px] font-mono text-slate-400 shrink-0 tabular-nums">
                              {c.progress.done}/{c.progress.total}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Siblings list (non-root tasks) */}
              {data.siblings.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                    Siblings ({data.siblings.length})
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {data.siblings.map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => {
                            if (onNavigate) {
                              onNavigate(s.id)
                            } else {
                              const url = new URL(window.location.href)
                              url.searchParams.set('task', String(s.id))
                              window.history.pushState(null, '', url.toString())
                              window.dispatchEvent(new PopStateEvent('popstate'))
                            }
                          }}
                          className="flex items-center gap-2 py-1 px-1.5 w-full text-left rounded text-xs hover:bg-slate-800/60 transition-colors"
                        >
                          <StatusGlyph status={s.status} />
                          <TypeBadge type={s.type} />
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">#{s.id}</span>
                          <span className="flex-1 min-w-0 text-slate-200 truncate">{s.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Description */}
              {data.task.description && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Description</p>
                  <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {data.task.description}
                  </p>
                </div>
              )}

              {/* Meta fields */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Project">{data.task.project_name}</Field>
                {data.task.pr_number != null && (
                  <Field label="PR">
                    <a
                      href={`https://github.com/search?q=${encodeURIComponent(data.task.branch ?? String(data.task.pr_number))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      PR#{data.task.pr_number}
                    </a>
                  </Field>
                )}
                {data.task.branch && (
                  <Field label="Branch">
                    <code className="text-[10px] bg-gray-800 px-1 py-0.5 rounded">{data.task.branch}</code>
                  </Field>
                )}
                <Field label="Created">{formatDate(data.task.created_at)}</Field>
                <Field label="Updated">{formatDate(data.task.updated_at)}</Field>
                {data.task.completed_at && (
                  <Field label="Completed">{formatDate(data.task.completed_at)}</Field>
                )}
              </div>

              {/* Related docs */}
              {data.docs.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Related Docs</p>
                  <div className="flex flex-col gap-1">
                    {data.docs.map((doc, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={`text-[9px] px-1 py-0.5 rounded uppercase ${
                          doc.type === 'spec'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800'
                            : 'bg-gray-800 text-gray-500 border border-gray-700'
                        }`}>
                          {doc.type}
                        </span>
                        <code className="text-[10px] text-gray-400 truncate">{doc.path}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* History timeline */}
              {data.steps.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">History</p>
                  <div className="flex flex-col gap-2 border-l border-gray-700 pl-3 ml-1">
                    {data.steps.map((step, i) => (
                      <div key={i} className="relative">
                        <div className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-gray-700 border border-gray-600" />
                        <p className="text-xs text-gray-300">{step.label}</p>
                        <p className="text-[10px] text-gray-600">{formatDate(step.timestamp)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {data.notes.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Notes</p>
                  <div className="flex flex-col gap-2">
                    {data.notes.map((note, i) => (
                      <div key={i} className="rounded-lg px-3 py-2 border" style={{ background: 'var(--wf-bg-card)', borderColor: 'var(--wf-border)' }}>
                        <p className="text-xs text-gray-300 leading-relaxed">{note.content}</p>
                        <p className="text-[10px] text-gray-600 mt-1">
                          {note.added_by} · {formatDate(note.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

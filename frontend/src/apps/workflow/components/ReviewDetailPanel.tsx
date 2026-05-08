import { useState } from 'react'
import useSWR from 'swr'
import { fetchJson } from '../lib/api'
import { formatDuration, formatElapsed, formatTimeAgo } from '../lib/time'
import type { HandoffNote, PipelineState } from '../types'

function durationForRun(pipeline: PipelineState): string {
  if (!pipeline.completed_at) return formatElapsed(pipeline.started_at)
  const ms = new Date(pipeline.completed_at).getTime() - new Date(pipeline.started_at).getTime()
  return formatDuration(Math.max(0, Math.round(ms / 1000)))
}

function fieldValue(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  return String(value)
}

export interface ReviewDetailPanelProps {
  pipeline: PipelineState
  isStalled: boolean
  stalledStep: string
  onClose: () => void
  onDismiss: () => void
}

export default function ReviewDetailPanel({
  pipeline,
  isStalled,
  stalledStep,
  onClose,
  onDismiss,
}: ReviewDetailPanelProps) {
  const { data: handoff } = useSWR<HandoffNote>(
    `/handoff/${pipeline.task_id}`,
    fetchJson<HandoffNote>,
  )
  const [busyAction, setBusyAction] = useState<'launch' | 'dismiss' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function launchSession() {
    setBusyAction('launch')
    setError(null)
    try {
      const res = await fetch('/workflow/api/launch-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: pipeline.session_id }),
      })
      if (!res.ok) throw new Error(`Launch failed: ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume session')
    } finally {
      setBusyAction(null)
    }
  }

  async function dismissRun() {
    setBusyAction('dismiss')
    setError(null)
    try {
      const res = await fetch(`/workflow/api/pipeline-runs/${pipeline.task_id}/dismiss`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`Dismiss failed: ${res.status}`)
      onDismiss()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss run')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <aside className="w-[300px] shrink-0 border-l border-gray-800 bg-gray-950 flex flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-gray-800 px-3 py-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Review detail</p>
          <p className="mt-1 truncate text-sm font-medium text-gray-100">#{pipeline.task_id} {pipeline.title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-900 hover:text-gray-200 transition-colors"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {error && (
          <div className="rounded border border-red-800 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">
            {error}
          </div>
        )}

        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Run info</p>
          <div className="grid grid-cols-1 gap-2 text-xs text-gray-300">
            <Field label="Type / size" value={`${pipeline.pipeline} · ${pipeline.size}`} />
            <Field label="Domain" value={fieldValue(pipeline.domain)} />
            <Field label="Started" value={`${formatElapsed(pipeline.started_at)} ago`} />
            <Field
              label="Duration"
              value={durationForRun(pipeline)}
              tone={isStalled ? 'amber' : 'default'}
            />
            <Field label="Tokens" value={pipeline.tokens_consumed && pipeline.tokens_consumed > 0 ? `${Math.round(pipeline.tokens_consumed / 1000)}k` : '—'} />
            <Field label="Session ID" value={pipeline.session_id} mono />
            <Field label="Heartbeat" value={formatTimeAgo(pipeline.heartbeat_at)} />
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Step breakdown</p>
          <div className="space-y-1">
            {Object.entries(pipeline.steps).map(([stepName, stepState]) => {
              const active = isStalled && stepName === stalledStep
              return (
                <div
                  key={stepName}
                  className={[
                    'flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs',
                    active ? 'border-amber-500/50 bg-amber-950/20 text-amber-200' : 'border-gray-800 bg-gray-900/40 text-gray-300',
                  ].join(' ')}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 text-center">
                      {stepState.status === 'done' ? '✓' : stepState.status === 'failed' ? '✗' : '–'}
                    </span>
                    <span className="truncate">{stepName}</span>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
                    {stepState.tokens_consumed != null && stepState.tokens_consumed > 0
                      ? `${Math.round(stepState.tokens_consumed / 1000)}k tok`
                      : active ? formatElapsed(pipeline.started_at) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {handoff?.found && (
          <section className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Last handoff note</p>
            <div className="rounded border border-gray-800 bg-gray-900/50 p-2 text-xs text-gray-300 space-y-2">
              <Field label="Branch" value={fieldValue(handoff.branch)} />
              <Field label="Last state" value={fieldValue(handoff.last_state)} mono />
              <Field label="Decision" value={fieldValue(handoff.decision)} />
            </div>
          </section>
        )}
      </div>

      <div className="border-t border-gray-800 px-3 py-3 space-y-2">
        <button
          type="button"
          onClick={launchSession}
          disabled={busyAction !== null}
          className="w-full rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyAction === 'launch' ? 'Launching...' : 'Resume session'}
        </button>
        <button
          type="button"
          onClick={dismissRun}
          disabled={busyAction !== null}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-200 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyAction === 'dismiss' ? 'Dismissing...' : 'Dismiss'}
        </button>
      </div>
    </aside>
  )
}

function Field({
  label,
  value,
  mono = false,
  tone = 'default',
}: {
  label: string
  value: string
  mono?: boolean
  tone?: 'default' | 'amber'
}) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">{label}</div>
      <div
        className={[
          'mt-0.5 text-[11px]',
          mono ? 'font-mono break-all' : 'break-words',
          tone === 'amber' ? 'text-amber-300' : 'text-gray-200',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { splannerApi } from '../lib/api'
import type { ApplyResult, CheckinOp, ConvertResult, ItemOp, ObjectiveOp, ProposalOp } from '../types'

interface ProposalReviewProps {
  projectId: number
  result: ConvertResult
  onClose: () => void
  onApplied: () => void | Promise<void>
}

interface ApplyFailureDetail {
  failed_op?: unknown
  reason: string
}

function cloneOp(op: ProposalOp): ProposalOp {
  if (op.type === 'objective') return { ...op }
  if (op.type === 'item') return { ...op }
  return { ...op }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseApplyFailure(error: unknown): ApplyFailureDetail | null {
  if (!(error instanceof Error)) return null

  try {
    const parsed: unknown = JSON.parse(error.message)
    if (!isRecord(parsed) || typeof parsed.reason !== 'string') return null
    return {
      failed_op: 'failed_op' in parsed ? parsed.failed_op : undefined,
      reason: parsed.reason,
    }
  } catch {
    return null
  }
}

function summarizeFailedOp(op: unknown): string {
  if (!isRecord(op) || typeof op.type !== 'string') return ''

  if (op.type === 'objective' && typeof op.name === 'string') {
    return `objective "${op.name}"`
  }
  if (op.type === 'item' && typeof op.name === 'string') {
    return `item "${op.name}"`
  }
  if (op.type === 'checkin' && typeof op.kind === 'string') {
    return `check-in (${op.kind})`
  }
  return ''
}

function describeObjectiveRef(op: ItemOp): string {
  if (op.new_objective_name) return `new: ${op.new_objective_name}`
  if (op.objective_id !== null) return `obj #${op.objective_id}`
  return 'unresolved objective'
}

function summarizeOp(op: ProposalOp): string {
  if (op.type === 'objective') {
    return op.metric ? `Objective: ${op.name} · ${op.metric}` : `Objective: ${op.name}`
  }
  if (op.type === 'item') {
    return `Item: ${op.name} · ${describeObjectiveRef(op)}`
  }
  return `Check-in: ${op.kind} · ${op.level}${op.target_id !== null ? ` #${op.target_id}` : ''}`
}

function updateObjective(
  ops: ProposalOp[],
  index: number,
  updater: (op: ObjectiveOp) => ObjectiveOp,
): ProposalOp[] {
  return ops.map((op, opIndex) => (opIndex === index && op.type === 'objective' ? updater(op) : op))
}

function updateItem(ops: ProposalOp[], index: number, updater: (op: ItemOp) => ItemOp): ProposalOp[] {
  return ops.map((op, opIndex) => (opIndex === index && op.type === 'item' ? updater(op) : op))
}

function updateCheckin(
  ops: ProposalOp[],
  index: number,
  updater: (op: CheckinOp) => CheckinOp,
): ProposalOp[] {
  return ops.map((op, opIndex) => (opIndex === index && op.type === 'checkin' ? updater(op) : op))
}

function formatTktErrors(result: ApplyResult): string | null {
  if (result.tkt_errors.length === 0) return null
  return result.tkt_errors
    .map((entry) => `${entry.type} #${entry.id}: ${JSON.stringify(entry.detail)}`)
    .join('\n')
}

export default function ProposalReview({ projectId, result, onClose, onApplied }: ProposalReviewProps) {
  const [ops, setOps] = useState<ProposalOp[]>(() => result.ops.map(cloneOp))
  const [selected, setSelected] = useState<boolean[]>(() => result.ops.map(() => true))
  const [isApplying, setIsApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  useEffect(() => {
    setOps(result.ops.map(cloneOp))
    setSelected(result.ops.map(() => true))
    setApplyError(null)
  }, [result])

  const selectedOps = useMemo(
    () => ops.filter((_, index) => selected[index]),
    [ops, selected],
  )

  async function handleApply() {
    if (selectedOps.length === 0) return

    setIsApplying(true)
    setApplyError(null)
    try {
      const applyResult = await splannerApi.applyDiscussion(projectId, selectedOps)
      const tktErrors = formatTktErrors(applyResult)
      if (tktErrors) {
        window.alert(`Applied locally, but some tkt syncs failed:\n${tktErrors}`)
      }
      await onApplied()
      onClose()
    } catch (error) {
      const failure = parseApplyFailure(error)
      if (failure) {
        const failedOpSummary = failure.failed_op ? summarizeFailedOp(failure.failed_op) : ''
        setApplyError(
          failedOpSummary ? `${failure.reason} (${failedOpSummary})` : failure.reason,
        )
      } else {
        setApplyError(error instanceof Error ? error.message : 'Failed to apply proposal.')
      }
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-gray-800 pb-4">
        <div>
          <h3 className="text-sm font-medium text-gray-100">Proposal review</h3>
          <p className="mt-1 text-xs text-gray-500">
            Review each suggested operation before applying it to the project.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
        >
          Close
        </button>
      </div>

      <div className="space-y-3">
        {ops.map((op, index) => (
          <article key={`${op.type}-${index}`} className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="mb-3 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected[index] ?? false}
                onChange={(event) =>
                  setSelected((prev) =>
                    prev.map((value, valueIndex) => (valueIndex === index ? event.target.checked : value)),
                  )
                }
                className="mt-1 h-4 w-4 rounded border-gray-700 bg-gray-900 text-gray-200 focus:ring-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gray-400">
                    {op.type}
                  </span>
                  <p className="text-sm text-gray-100">{summarizeOp(op)}</p>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {op.type === 'objective' && 'Objectives may optionally create an epic in work context.'}
                  {op.type === 'item' && 'Items may optionally create a ticket in work context.'}
                  {op.type === 'checkin' && 'Check-ins keep their backend scope and target as generated.'}
                </p>
              </div>
            </div>

            {op.type === 'objective' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={op.name}
                  onChange={(event) =>
                    setOps((prev) => updateObjective(prev, index, (entry) => ({ ...entry, name: event.target.value })))
                  }
                  placeholder="Objective name"
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <input
                  value={op.metric ?? ''}
                  onChange={(event) =>
                    setOps((prev) =>
                      updateObjective(prev, index, (entry) => ({
                        ...entry,
                        metric: event.target.value.trim() ? event.target.value : null,
                      })),
                    )
                  }
                  placeholder="Metric"
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <input
                  value={op.target ?? ''}
                  onChange={(event) =>
                    setOps((prev) =>
                      updateObjective(prev, index, (entry) => ({
                        ...entry,
                        target: event.target.value.trim() ? event.target.value : null,
                      })),
                    )
                  }
                  placeholder="Target"
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <input
                  value={op.unit ?? ''}
                  onChange={(event) =>
                    setOps((prev) =>
                      updateObjective(prev, index, (entry) => ({
                        ...entry,
                        unit: event.target.value.trim() ? event.target.value : null,
                      })),
                    )
                  }
                  placeholder="Unit"
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={op.make_epic}
                    onChange={(event) =>
                      setOps((prev) =>
                        updateObjective(prev, index, (entry) => ({ ...entry, make_epic: event.target.checked })),
                      )
                    }
                    className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-gray-200 focus:ring-0"
                  />
                  Create epic after local apply
                </label>
              </div>
            ) : null}

            {op.type === 'item' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-400">
                  {describeObjectiveRef(op)}
                </div>
                <input
                  value={op.name}
                  onChange={(event) =>
                    setOps((prev) => updateItem(prev, index, (entry) => ({ ...entry, name: event.target.value })))
                  }
                  placeholder="Item name"
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={op.make_ticket}
                    onChange={(event) =>
                      setOps((prev) =>
                        updateItem(prev, index, (entry) => ({ ...entry, make_ticket: event.target.checked })),
                      )
                    }
                    className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-gray-200 focus:ring-0"
                  />
                  Create ticket after local apply
                </label>
              </div>
            ) : null}

            {op.type === 'checkin' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span className="rounded-full border border-gray-800 bg-gray-900 px-2.5 py-1">
                    {op.level}
                  </span>
                  <span className="rounded-full border border-gray-800 bg-gray-900 px-2.5 py-1">
                    {op.target_id === null ? 'no target id' : `target #${op.target_id}`}
                  </span>
                </div>
                <select
                  value={op.kind}
                  onChange={(event) =>
                    setOps((prev) =>
                      updateCheckin(prev, index, (entry) => ({
                        ...entry,
                        kind: event.target.value as CheckinOp['kind'],
                      })),
                    )
                  }
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
                >
                  <option value="win">win</option>
                  <option value="risk">risk</option>
                  <option value="decision">decision</option>
                  <option value="blocked">blocked</option>
                  <option value="note">note</option>
                </select>
                <textarea
                  value={op.body}
                  onChange={(event) =>
                    setOps((prev) => updateCheckin(prev, index, (entry) => ({ ...entry, body: event.target.value })))
                  }
                  rows={4}
                  placeholder="Check-in detail"
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {result.dropped.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-200">
            Couldn&apos;t parse {result.dropped.length} suggestion{result.dropped.length === 1 ? '' : 's'}
          </p>
          <div className="mt-2 space-y-2">
            {result.dropped.map((entry, index) => (
              <div key={`${entry.reason}-${index}`} className="text-xs text-amber-100/80">
                {entry.reason}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {applyError ? (
        <div className="mt-4 rounded-xl border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {applyError}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-800 pt-4">
        <p className="text-xs text-gray-500">
          {selectedOps.length} of {ops.length} op{ops.length === 1 ? '' : 's'} selected
        </p>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={isApplying || selectedOps.length === 0}
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isApplying ? 'Applying…' : 'Apply selected'}
        </button>
      </div>
    </section>
  )
}

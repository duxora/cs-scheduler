import { useEffect, useRef, useState } from 'react'
import { splannerApi } from '../lib/api'
import type { Checkin, CheckinKind, CreateCheckinPayload } from '../types'

const KIND_OPTIONS: CheckinKind[] = ['note', 'win', 'risk', 'decision', 'blocked']

export interface CheckinComposerScope {
  projectId?: number
  objectiveId?: number
  itemId?: number
  label: string
}

interface CheckinComposerProps {
  scope: CheckinComposerScope
  onCreated: (checkin: Checkin) => Promise<void> | void
}

function buildPayload(scope: CheckinComposerScope, body: string, kind: CheckinKind): CreateCheckinPayload {
  if (scope.itemId !== undefined) {
    return { body, kind, item_id: scope.itemId }
  }
  if (scope.objectiveId !== undefined) {
    return { body, kind, objective_id: scope.objectiveId }
  }
  if (scope.projectId !== undefined) {
    return { body, kind, project_id: scope.projectId }
  }
  return { body, kind }
}

function broadenScope(scope: CheckinComposerScope): CheckinComposerScope {
  if (scope.itemId !== undefined) {
    return {
      projectId: scope.projectId,
      objectiveId: scope.objectiveId,
      label: scope.label,
    }
  }

  if (scope.objectiveId !== undefined) {
    return {
      projectId: scope.projectId,
      label: scope.label,
    }
  }

  return scope
}

function describeScope(scope: CheckinComposerScope): string {
  if (scope.itemId !== undefined) return `Item scope · ${scope.label}`
  if (scope.objectiveId !== undefined) return `Objective scope · ${scope.label}`
  if (scope.projectId !== undefined) return `Project scope · ${scope.label}`
  return `General scope · ${scope.label}`
}

export default function CheckinComposer({ scope, onCreated }: CheckinComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<CheckinKind>('note')
  const [isOpen, setIsOpen] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeScope, setActiveScope] = useState<CheckinComposerScope>(scope)

  useEffect(() => {
    setActiveScope(scope)
  }, [scope])

  useEffect(() => {
    if (isOpen) {
      textareaRef.current?.focus()
    }
  }, [isOpen, activeScope])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsOpen(true)
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
        })
        return
      }

      if (event.key === 'Escape') {
        setIsOpen(false)
        return
      }

      if (event.metaKey && event.key === 'ArrowUp' && document.activeElement === textareaRef.current) {
        event.preventDefault()
        setActiveScope((prev) => broadenScope(prev))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextBody = body.trim()
    if (!nextBody) return

    setIsSubmitting(true)
    setError(null)
    try {
      const checkin = await splannerApi.createCheckin(buildPayload(activeScope, nextBody, kind))
      setBody('')
      setKind('note')
      await onCreated(checkin)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create check-in.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-gray-100">Quick check-in</h2>
          <p className="mt-1 text-xs text-gray-500">{describeScope(activeScope)}</p>
          <p className="mt-1 text-[11px] text-gray-600">⌘K opens or focuses. Esc closes. ⌘↑ broadens scope.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
        >
          {isOpen ? 'Hide' : 'Open'}
        </button>
      </div>

      {isOpen ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)]">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as CheckinKind)}
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              placeholder="Capture the latest signal, decision, or blocker…"
              className="min-h-[112px] rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-300" role="alert">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">Manual classification is required in this slice.</span>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg border border-gray-700 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Saving…' : 'Post check-in'}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
          Composer closed.
        </div>
      )}
    </section>
  )
}

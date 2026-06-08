import { useEffect, useRef, useState } from 'react'
import { splannerApi } from '../lib/api'
import type { ConvertResult, DiscussionMessage } from '../types'
import ProposalReview from './ProposalReview'

interface DiscussionPanelProps {
  projectId: number
  onApplied: () => void | Promise<void>
}

function formatTimestamp(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return createdAt
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildOptimisticMessage(content: string): DiscussionMessage {
  return {
    id: -Date.now(),
    role: 'user',
    content,
    created_at: new Date().toISOString(),
  }
}

export default function DiscussionPanel({ projectId, onApplied }: DiscussionPanelProps) {
  const threadRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<DiscussionMessage[]>([])
  const [draft, setDraft] = useState('')
  const [reviewResult, setReviewResult] = useState<ConvertResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadDiscussion() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const result = await splannerApi.getDiscussion(projectId)
        if (cancelled) return
        setMessages(result.messages)
      } catch (error) {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Failed to load discussion.')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadDiscussion()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const element = threadRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [messages, isSending])

  async function refreshDiscussion() {
    const result = await splannerApi.getDiscussion(projectId)
    setMessages(result.messages)
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || isSending) return

    const optimisticMessage = buildOptimisticMessage(text)
    setMessages((prev) => [...prev, optimisticMessage])
    setDraft('')
    setIsSending(true)
    setActionError(null)

    try {
      await splannerApi.postDiscussionMessage(projectId, text)
      await refreshDiscussion()
    } catch (error) {
      setDraft(text)
      setActionError(error instanceof Error ? error.message : 'Failed to send message.')
    } finally {
      setIsSending(false)
    }
  }

  async function handleConvert() {
    if (isSending || isConverting) return

    setIsConverting(true)
    setActionError(null)
    try {
      const result = await splannerApi.convertDiscussion(projectId)
      setReviewResult(result)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to convert discussion.')
    } finally {
      setIsConverting(false)
    }
  }

  async function handleApplied() {
    await Promise.all([refreshDiscussion(), onApplied()])
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-gray-800 pb-4">
          <div>
            <h2 className="text-sm font-medium text-gray-100">Discuss</h2>
            <p className="mt-1 text-xs text-gray-500">
              Ask Claude for grounded project guidance, then convert the thread into plan ops.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshDiscussion().catch(() => undefined)}
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
          >
            Refresh
          </button>
        </div>

        <div
          ref={threadRef}
          className="max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border border-gray-800 bg-gray-950/60 p-3"
        >
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading discussion…</p>
          ) : null}

          {!isLoading && messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/40 px-4 py-6 text-sm text-gray-500">
              Start the thread with a project question, blocker, or idea you want turned into a plan.
            </div>
          ) : null}

          {messages.map((message) => {
            if (message.role === 'system') {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="max-w-2xl rounded-full border border-gray-800 bg-gray-900 px-3 py-1 text-[11px] text-gray-500">
                    {message.content}
                  </div>
                </div>
              )
            }

            const isUser = message.role === 'user'
            return (
              <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-2xl rounded-2xl border px-4 py-3 ${
                    isUser
                      ? 'border-blue-800 bg-blue-950/30 text-blue-100'
                      : 'border-gray-800 bg-gray-900 text-gray-100'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      {isUser ? 'You' : 'Claude'}
                    </span>
                    <span className="text-[11px] text-gray-600">{formatTimestamp(message.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                </div>
              </div>
            )
          })}

          {isSending ? (
            <div className="flex justify-start">
              <div className="max-w-2xl rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-400">
                Claude is thinking…
              </div>
            </div>
          ) : null}
        </div>

        {loadError ? (
          <div className="mt-4 rounded-xl border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {loadError}
          </div>
        ) : null}

        {actionError ? (
          <div className="mt-4 rounded-xl border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {actionError}
          </div>
        ) : null}

        <form onSubmit={handleSend} className="mt-4 space-y-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder="Ask about the project, blockers, priorities, or what to do next…"
            className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              The thread is project-scoped and reuses the persisted discussion history.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleConvert()}
                disabled={isSending || isConverting}
                className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isConverting ? 'Converting…' : 'Convert to plan'}
              </button>
              <button
                type="submit"
                disabled={isSending || draft.trim().length === 0}
                className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </form>
      </section>

      {reviewResult ? (
        <ProposalReview
          projectId={projectId}
          result={reviewResult}
          onClose={() => setReviewResult(null)}
          onApplied={handleApplied}
        />
      ) : null}
    </div>
  )
}

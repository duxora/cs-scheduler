import { useMemo } from 'react'
import useSWR from 'swr'
import type { Session } from '../types'
import { useSessions } from '../hooks/useSessions'
import { useUrlParam } from '../hooks/useUrlParam'
import { fetchJson } from '../lib/api'
import { formatTimeAgo, formatElapsed } from '../lib/time'

// ── types ──────────────────────────────────────────────────────────────────

interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

interface SessionPreview {
  turns: ConversationTurn[]
  totalTurns: number
}

// ── sub-components ─────────────────────────────────────────────────────────

function AliveIndicator({ alive }: { alive: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${alive ? 'bg-emerald-500' : 'bg-gray-600'}`}
      aria-label={alive ? 'alive' : 'dead'}
    />
  )
}

interface PreviewPanelProps {
  sessionId: string
}

function PreviewPanel({ sessionId }: PreviewPanelProps) {
  const { data, isLoading, error } = useSWR<SessionPreview>(
    `/sessions/${sessionId}/preview`,
    fetchJson<SessionPreview>,
  )

  if (isLoading) {
    return (
      <div className="px-4 py-3 border-t border-gray-700">
        <span className="text-[10px] text-gray-600">Loading preview...</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="px-4 py-3 border-t border-gray-700">
        <span className="text-[10px] text-red-400">Failed to load preview</span>
      </div>
    )
  }

  const shownTurns = data.turns.slice(0, 20)

  return (
    <div className="px-4 py-3 border-t border-gray-700">
      <p className="text-[10px] text-gray-500 mb-2 font-medium uppercase tracking-wide">
        Conversation Preview
      </p>
      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
        {shownTurns.map((turn, i) => (
          <div
            // Turns don't have stable IDs; index is the only key available
            key={i}
            className={`px-2 py-1.5 rounded text-[10px] leading-relaxed ${
              turn.role === 'user'
                ? 'bg-gray-700/60 text-gray-300'
                : 'bg-gray-800/80 text-gray-400'
            }`}
          >
            <span className="font-medium mr-1.5">
              {turn.role === 'user' ? 'User' : 'Assistant'}:
            </span>
            <span className="whitespace-pre-wrap break-words">{turn.text}</span>
          </div>
        ))}
      </div>
      {data.totalTurns > 20 && (
        <p className="text-[10px] text-gray-600 mt-2">
          {shownTurns.length} of {data.totalTurns} turns shown
        </p>
      )}
    </div>
  )
}

interface SessionRowProps {
  session: Session
  expanded: boolean
  onToggle: () => void
}

function SessionRow({ session, expanded, onToggle }: SessionRowProps) {
  const shortId = session.sessionId.slice(0, 8)
  const cwd = session.cwd

  return (
    <div
      className={`bg-gray-800/50 border rounded-lg overflow-hidden transition-colors ${
        session.alive ? 'border-gray-700 hover:border-gray-600' : 'border-gray-800 opacity-70'
      }`}
    >
      {/* Main row */}
      <button
        className="w-full text-left px-4 py-3 flex flex-col gap-1"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <AliveIndicator alive={session.alive} />
          <span className="text-xs font-mono text-gray-300">{shortId}...</span>
          <span className="text-[10px] text-gray-500">PID: {session.pid}</span>
          {session.task_id != null && (
            <span className="text-[10px] text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded border border-blue-900">
              Task #{session.task_id}
            </span>
          )}
          {session.name && (
            <span className="text-[10px] text-gray-400 truncate">{session.name}</span>
          )}
          <span
            className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
              session.alive
                ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-900'
                : 'text-gray-500 bg-gray-900 border border-gray-800'
            }`}
          >
            {session.alive ? 'alive' : 'dead'}
          </span>
        </div>

        <div className="text-[10px] text-gray-600 font-mono truncate ml-4" title={cwd}>
          {cwd}
        </div>

        <div className="flex items-center gap-3 ml-4 text-[10px] text-gray-600">
          <span>Started: {formatElapsed(session.startedAt)} ago</span>
          {session.heartbeat_at && (
            <span>Heartbeat: {formatTimeAgo(session.heartbeat_at)}</span>
          )}
        </div>
      </button>

      {/* Expanded preview */}
      {expanded && <PreviewPanel sessionId={session.sessionId} />}
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────

export default function SessionsPage() {
  const { sessions, error, isLoading } = useSessions()
  const [expandedId, setExpandedId] = useUrlParam('session')

  // Sort: alive first, then by startedAt descending
  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    })
  }, [sessions])

  const aliveCount = sessions.filter((s) => s.alive).length

  const handleToggle = (sessionId: string) => {
    setExpandedId(expandedId === sessionId ? '' : sessionId)
  }

  return (
    <div className="flex flex-col h-full text-gray-100 bg-gray-950">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-medium text-gray-300">Sessions</span>
        <span className="text-[10px] text-emerald-400 bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-900">
          {aliveCount} alive
        </span>
        <span className="text-[10px] text-gray-600 ml-auto">
          {isLoading && 'Loading...'}
          {!isLoading && `${sorted.length} total`}
        </span>
        {error && (
          <span className="text-[10px] text-red-400 bg-red-950 px-1.5 py-0.5 rounded border border-red-800">
            API error
          </span>
        )}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-gray-600">Loading sessions...</span>
          </div>
        )}

        {!isLoading && sorted.length === 0 && !error && (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-gray-600">No sessions found</span>
          </div>
        )}

        {!isLoading && error && sorted.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-red-400">Failed to load sessions</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {sorted.map((session) => (
            <SessionRow
              key={session.sessionId}
              session={session}
              expanded={expandedId === session.sessionId}
              onToggle={() => handleToggle(session.sessionId)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

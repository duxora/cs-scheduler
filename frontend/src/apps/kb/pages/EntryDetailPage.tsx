import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { fetcher } from '../../../shared/fetcher'
import { deleteEntry } from '../lib/api'
import { domainBadgeClass, confidenceBadgeClass, formatDate } from '../lib/domain'
import type { KBEntry } from '../types'

function estimateReadTime(text: string): string {
  const words = text.trim().split(/\s+/).length
  const minutes = Math.max(1, Math.round(words / 200))
  return `${minutes} min read`
}

// Reframe a declarative takeaway into a discussion question
function toDiscussionQuestion(takeaway: string): string {
  const s = takeaway.trim().replace(/\.$/, '')
  // Pattern: "Avoid X" → "How does your team currently handle X?"
  const avoidMatch = s.match(/^Avoid (.+)/i)
  if (avoidMatch?.[1]) return `How does your team currently handle ${avoidMatch[1].toLowerCase()}?`
  const investMatch = s.match(/^Invest in (.+)/i)
  if (investMatch?.[1]) return `How much are we investing in ${investMatch[1].toLowerCase()}?`
  const challengeMatch = s.match(/^Challenge (.+)/i)
  if (challengeMatch?.[1]) return `Do we challenge ${challengeMatch[1].toLowerCase()} enough?`
  const recognizeMatch = s.match(/^(Recognize|Understand|Ensure|Consider|Use|Leverage) (.+)/i)
  if (recognizeMatch?.[1] && recognizeMatch?.[2]) return `Do we ${recognizeMatch[1].toLowerCase()} ${recognizeMatch[2].toLowerCase()}?`
  // Fallback: prepend "How does this apply to..."
  return `How does this apply to us: "${s}"?`
}

export default function EntryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: entry, error, isLoading } = useSWR<KBEntry>(
    id ? `/kb/api/entry/${encodeURIComponent(id)}` : null,
    fetcher,
  )

  async function handleDelete() {
    if (!id) return
    const confirmed = window.confirm('Delete this entry? This cannot be undone.')
    if (!confirmed) return

    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteEntry(id)
      navigate('/kb', { replace: true })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
      setIsDeleting(false)
    }
  }

  function buildMarkdown(e: KBEntry): string {
    const lines: string[] = [`# ${e.title}`, '']
    lines.push('## Summary', e.summary, '')
    if (e.key_takeaways && e.key_takeaways.length > 0) {
      lines.push('## Key Takeaways')
      e.key_takeaways.forEach((t) => lines.push(`- ${t}`))
      lines.push('')
    }
    if (e.context) {
      lines.push('## When to Apply', e.context, '')
    }
    return lines.join('\n')
  }

  async function handleCopy() {
    if (!entry) return
    await navigator.clipboard.writeText(buildMarkdown(entry))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDownload() {
    if (!entry) return
    const blob = new Blob([buildMarkdown(entry)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${entry.id}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-950 text-gray-400">
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  if (error || (!isLoading && !entry?.id)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-gray-950 text-gray-400 gap-4">
        <p className="text-sm">{error ? 'Failed to load entry.' : 'Entry not found.'}</p>
        <Link to="/kb" className="text-blue-400 hover:underline text-sm">
          &larr; Back to Knowledge Base
        </Link>
      </div>
    )
  }

  if (!entry) return null // satisfies TypeScript narrowing

  return (
    <div className="bg-gray-950 text-gray-100 p-4 overflow-y-auto min-h-full">
      {/* Back nav */}
      <Link
        to="/kb"
        className="text-gray-500 hover:text-gray-300 text-sm mb-4 inline-block"
      >
        &larr; Back to Knowledge Base
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold break-words mb-3">{entry.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded border ${domainBadgeClass(entry.domain)}`}>
            {entry.domain}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded border ${confidenceBadgeClass(entry.confidence)}`}>
            {entry.confidence}
          </span>
          {entry.source_type && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-gray-700 text-gray-400">
              {entry.source_type}
            </span>
          )}
          <span className="text-xs text-gray-500">
            {estimateReadTime(entry.summary + ' ' + (entry.key_takeaways?.join(' ') ?? ''))}
          </span>
          <span className="text-xs text-gray-600">·</span>
          <span className="text-xs text-gray-500">{formatDate(entry.created)}</span>
          {entry.tags.map((tag) => (
            <span key={tag} className="text-xs text-gray-600">#{tag}</span>
          ))}
        </div>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content (2 cols) */}
        <div className="lg:col-span-2 space-y-5">
          {/* TL;DR hook — first takeaway as the headline insight */}
          {entry.key_takeaways && entry.key_takeaways.length > 0 && (
            <div className="border-l-4 border-blue-500 bg-blue-950/30 rounded-r-lg px-4 py-3">
              <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide mb-1">TL;DR</p>
              <p className="text-gray-200 font-medium leading-snug">{entry.key_takeaways[0]}</p>
            </div>
          )}

          {/* Summary */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Overview</h2>
            <p className="text-gray-200 leading-relaxed text-[15px]">{entry.summary}</p>
            {entry.source && (
              <a
                href={entry.source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 text-xs text-blue-400 hover:text-blue-300 border border-blue-800/60 hover:border-blue-600 bg-blue-950/20 px-3 py-1.5 rounded transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Read original source
              </a>
            )}
          </div>

          {/* Key Takeaways */}
          {entry.key_takeaways && entry.key_takeaways.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Key Takeaways</h2>
              <ul className="space-y-3">
                {entry.key_takeaways.map((takeaway, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-blue-400 font-bold text-sm mt-0.5 shrink-0">{i + 1}.</span>
                    <span className="text-gray-200 leading-snug">{takeaway}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Context / When to Apply */}
          {entry.context && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">When to Apply</h2>
              <p className="text-gray-200 leading-relaxed text-[15px]">{entry.context}</p>
            </div>
          )}

          {/* Discussion questions for team sharing */}
          {entry.key_takeaways && entry.key_takeaways.length > 1 && (
            <div className="bg-amber-950/20 border border-amber-800/40 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wide mb-3">
                Discussion Questions
              </h2>
              <p className="text-xs text-gray-500 mb-3">For team sharing or tech talks — use these to spark conversation.</p>
              <ul className="space-y-2">
                {entry.key_takeaways.slice(0, 4).map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-amber-500 shrink-0 mt-0.5">?</span>
                    <span className="text-gray-300 text-sm leading-snug">{toDiscussionQuestion(t)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Sidebar (1 col) */}
        <div className="space-y-6">
          {/* Metadata */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Details</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500 text-xs mb-0.5">Entry ID</dt>
                <dd><code className="text-xs bg-gray-900 px-1.5 py-0.5 rounded text-gray-300">{entry.id}</code></dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs mb-0.5">Indexed</dt>
                <dd className="text-gray-300">{formatDate(entry.created)}</dd>
              </div>
              {entry.expires && (
                <div>
                  <dt className="text-gray-500 text-xs mb-0.5">Expires</dt>
                  <dd className="text-gray-300">{entry.expires}</dd>
                </div>
              )}
              {entry.tags.length > 0 && (
                <div>
                  <dt className="text-gray-500 text-xs mb-1">Tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {entry.tags.map((tag) => (
                      <span key={tag} className="bg-gray-900 px-2 py-0.5 rounded text-xs text-gray-400">
                        #{tag}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Actions */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-3">Actions</h2>
            {deleteError && (
              <p className="text-xs text-red-400 mb-2">{deleteError}</p>
            )}
            <div className="flex gap-2 mb-3">
              <button
                onClick={handleCopy}
                className="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 rounded transition-colors"
              >
                {copied ? 'Copied!' : 'Copy MD'}
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 rounded transition-colors"
              >
                Download
              </button>
            </div>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-full px-3 py-2 text-sm bg-red-900/60 hover:bg-red-800/60 text-red-300 border border-red-700 rounded transition-colors disabled:opacity-50"
              aria-label="Delete this knowledge base entry"
            >
              {isDeleting ? 'Deleting…' : 'Delete Entry'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

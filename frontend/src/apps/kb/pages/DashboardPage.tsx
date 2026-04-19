import { useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { useKBStats } from '../hooks/useKBStats'
import { useKBSearch } from '../hooks/useKBSearch'
import { ingestUrl } from '../lib/api'
import { KB_DOMAINS, domainBadgeClass, confidenceBadgeClass, formatDate } from '../lib/domain'
import type { KBEntry, KBDomain } from '../types'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// --------------------------------------------------------------------------
// IngestModal
// --------------------------------------------------------------------------

interface IngestModalProps {
  onClose: () => void
  onSuccess: () => void
}

function IngestModal({ onClose, onSuccess }: IngestModalProps) {
  const [url, setUrl] = useState('')
  const [domain, setDomain] = useState<KBDomain>('tech-trends')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setIsSubmitting(true)
    setResult(null)
    try {
      const res = await ingestUrl({ url: url.trim(), domain })
      setResult(res)
      if (res.ok) {
        onSuccess()
        setTimeout(onClose, 1500)
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ingest-modal-title"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-lg mx-4">
        <h3 id="ingest-modal-title" className="text-lg font-semibold mb-4 text-gray-100">
          Ingest URL
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-400 mb-1" htmlFor="ingest-url">
              URL
            </label>
            <input
              id="ingest-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              required
              className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-400 mb-1" htmlFor="ingest-domain">
              Domain
            </label>
            <select
              id="ingest-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value as KBDomain)}
              className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
            >
              {KB_DOMAINS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {result && (
            <div
              className={`mb-3 text-sm px-3 py-2 rounded ${
                result.ok
                  ? 'bg-green-900/40 text-green-300 border border-green-700'
                  : 'bg-red-900/40 text-red-300 border border-red-700'
              }`}
              role="status"
            >
              {result.message}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
            >
              {isSubmitting ? 'Ingesting…' : 'Ingest'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// EntryCard (used in trending + browse results)
// --------------------------------------------------------------------------

interface EntryCardProps {
  entry: KBEntry
  showSummary?: boolean
}

function EntryCard({ entry, showSummary = true }: EntryCardProps) {
  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <Link
        to={`/kb/entry/${entry.id}`}
        className="text-blue-400 hover:text-blue-300 font-medium hover:underline"
      >
        {entry.title}
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        <span
          className={`text-xs px-1.5 py-0.5 rounded border ${domainBadgeClass(entry.domain)}`}
        >
          {entry.domain}
        </span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded border ${confidenceBadgeClass(entry.confidence)}`}
        >
          {entry.confidence}
        </span>
        {entry.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs text-gray-500">#{tag}</span>
        ))}
      </div>
      {showSummary && entry.summary && (
        <p className="text-sm text-gray-400 mt-1 line-clamp-2">
          {entry.summary.slice(0, 150)}{entry.summary.length > 150 ? '…' : ''}
        </p>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// DashboardPage
// --------------------------------------------------------------------------

export default function DashboardPage() {
  const { stats, isLoading: statsLoading, refresh: refreshStats } = useKBStats()
  const { entries: searchResults, isLoading: searchLoading, query, domain, setQuery, setDomain } = useKBSearch()
  const [showIngestModal, setShowIngestModal] = useState(false)
  const [browseDomain, setBrowseDomain] = useState<string>('')

  // Trending: last 7 days
  const { data: trending } = useSWR<KBEntry[]>(
    '/kb/api/trending?days=7&limit=5',
    fetcher,
    { refreshInterval: 30_000 },
  )

  // Recent entries
  const { data: recentEntries } = useSWR<KBEntry[]>(
    '/kb/api/recent?limit=10',
    fetcher,
    { refreshInterval: 30_000 },
  )

  // Browse by domain
  const { data: browseResults } = useSWR<KBEntry[]>(
    browseDomain ? `/kb/api/search?q=.&domain=${browseDomain}` : null,
    fetcher,
  )

  const hasSearchQuery = query.length >= 2

  return (
    <div className="flex flex-col min-h-full bg-gray-950 text-gray-100 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <button
          onClick={() => setShowIngestModal(true)}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
        >
          + Ingest URL
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 md:col-span-1">
          <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">Total Entries</div>
          <div className="text-2xl font-bold">
            {statsLoading ? '—' : (stats?.total_entries ?? 0)}
          </div>
        </div>
        {KB_DOMAINS.map((d) => (
          <div key={d} className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="text-gray-500 text-xs uppercase tracking-wide mb-1 truncate">{d}</div>
            <div className="text-2xl font-bold text-blue-400">
              {statsLoading ? '—' : (stats?.by_domain?.[d] ?? 0)}
            </div>
          </div>
        ))}
      </div>

      {/* Search bar */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search knowledge base..."
            aria-label="Search knowledge base"
            className="flex-1 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          />
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            aria-label="Filter by domain"
            className="bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Domains</option>
            {KB_DOMAINS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Search results */}
        {hasSearchQuery && (
          <div className="mt-4">
            {searchLoading && (
              <p className="text-xs text-gray-500">Searching…</p>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <p className="text-xs text-gray-500">No results for "{query}"</p>
            )}
            {!searchLoading && searchResults.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{query}"
                </p>
                {searchResults.map((entry) => (
                  <EntryCard key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two column: Trending + Domain Browser */}
      {!hasSearchQuery && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Trending */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-700">
              <h2 className="text-lg font-semibold">Trending (Last 7 Days)</h2>
            </div>
            <div className="p-4">
              {!trending || trending.length === 0 ? (
                <p className="text-gray-500 text-sm">No entries from the last 7 days.</p>
              ) : (
                trending.slice(0, 5).map((entry) => (
                  <EntryCard key={entry.id} entry={entry} />
                ))
              )}
            </div>
          </div>

          {/* Domain Browser */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-700">
              <h2 className="text-lg font-semibold">Browse by Domain</h2>
            </div>
            <div className="p-4">
              <div className="flex flex-wrap gap-2 mb-4">
                {KB_DOMAINS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setBrowseDomain(browseDomain === d ? '' : d)}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                      browseDomain === d
                        ? domainBadgeClass(d) + ' font-semibold'
                        : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500'
                    }`}
                  >
                    {d}
                    {stats?.by_domain?.[d] ? ` (${stats.by_domain[d]})` : ''}
                  </button>
                ))}
              </div>
              <div>
                {!browseDomain && (
                  <p className="text-gray-500 text-sm">Select a domain above to browse entries.</p>
                )}
                {browseDomain && !browseResults && (
                  <p className="text-xs text-gray-500">Loading…</p>
                )}
                {browseDomain && browseResults && browseResults.length === 0 && (
                  <p className="text-sm text-gray-500">No entries in {browseDomain}.</p>
                )}
                {browseDomain && browseResults && browseResults.length > 0 && (
                  browseResults.slice(0, 10).map((entry) => (
                    <EntryCard key={entry.id} entry={entry} showSummary={false} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Entries Table */}
      {!hasSearchQuery && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-700">
            <h2 className="text-lg font-semibold">Recent Entries</h2>
          </div>
          <div className="overflow-x-auto">
            {!recentEntries || recentEntries.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No entries yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Title</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Domain</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium hidden md:table-cell">Summary</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEntries.slice(0, 10).map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                      <td className="px-4 py-2">
                        <Link
                          to={`/kb/entry/${entry.id}`}
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          {entry.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${domainBadgeClass(entry.domain)}`}>
                          {entry.domain}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-400 hidden md:table-cell max-w-xs truncate">
                        {entry.summary}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                        {formatDate(entry.created)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Ingest modal */}
      {showIngestModal && (
        <IngestModal
          onClose={() => setShowIngestModal(false)}
          onSuccess={() => refreshStats()}
        />
      )}
    </div>
  )
}
